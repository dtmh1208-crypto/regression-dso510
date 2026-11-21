"""Local data and regression service. The source CSV is read-only."""
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import lru_cache
import argparse
import html
import json
import re
import threading
import zipfile
import numpy as np
import pandas as pd
from scipy.stats import t
from data_access import dataset_path, prepared, manifest

ROOT = Path(__file__).resolve().parent
LOCK = threading.RLock()

def plain(s):
    return re.sub(r'\s+', ' ', html.unescape(re.sub('<[^>]+>', ' ', s))).strip()

@lru_cache(maxsize=1)
def dictionary(prefer_packaged=True):
    packaged = ROOT / 'assets/codebook.json'
    if prefer_packaged and packaged.exists():
        return json.loads(packaged.read_text(encoding='utf-8'))
    result = {}
    with zipfile.ZipFile(next(ROOT.parent.glob('*.zip'))) as z:
        source = z.read(next(n for n in z.namelist() if n.endswith('.html'))).decode('utf-8')
    for table in re.findall(r'<table\b.*?</table>', source, re.S):
        text = plain(table)
        match = re.search(r'SAS Variable Name:\s*(\w+)', text)
        if not match:
            continue
        name = match[1]
        label = re.search(r'Label:\s*(.*?)\s*Section Name:', text)
        entries = []
        for row in re.findall(r'<tr\b.*?</tr>', table, re.S):
            cells = [plain(c) for c in re.findall(r'<td\b[^>]*>(.*?)</td>', row, re.S)]
            if len(cells) == 5 and cells[0] != 'Value':
                entries.append({'value': cells[0], 'label': cells[1]})
        exclude = []
        recode = {}
        for entry in entries:
            value, labeltext = entry['value'], entry['label'].lower().split('notes:')[0]
            if not re.fullmatch(r'\d+', value):
                continue
            if any(s in labeltext for s in ['don’t know', "don't know", 'don´t know', 'refused', 'missing', 'not asked']):
                exclude.append(float(value))
            if labeltext.strip() == 'none' and value == '88':
                recode[value] = 0
        result[name] = {'name': name, 'label': label[1] if label else name, 'codes': entries,
                        'rule': {'exclude': exclude, 'recode': recode, 'min': None, 'max': None}}
    return result

@lru_cache(maxsize=1)
def base():
    d = pd.read_csv(dataset_path(), usecols=['MENTHLTH', 'SLEPTIM1', 'EMPLOY1'])
    if prepared():
        if len(d) != manifest()['cohort_n']:
            raise RuntimeError('Prepared dataset row count differs from its manifest.')
        return d, manifest()['raw_n']
    d['MENTHLTH'] = d.MENTHLTH.replace(88, 0)
    mask = d.MENTHLTH.between(0,30) & d.SLEPTIM1.between(1,24) & d.EMPLOY1.between(1,8)
    return d.loc[mask].copy(), len(d)

@lru_cache(maxsize=32)
def column(name):
    d, _ = base()
    if name in d:
        return d[name]
    raw = pd.read_csv(dataset_path(), usecols=[name])[name]
    return pd.to_numeric(raw.loc[d.index], errors='coerce')

@lru_cache(maxsize=1)
def column_names():
    return manifest()['columns'] if prepared() else pd.read_csv(dataset_path(), nrows=0).columns.tolist()

def metadata():
    names = column_names()
    codes = dictionary()
    raw_n, base_n = (manifest()['raw_n'], manifest()['cohort_n']) if prepared() else (base()[1], len(base()[0]))
    return {'raw_n':raw_n, 'base_n':base_n, 'variables':[
        codes.get(n, {'name':n,'label':n,'codes':[], 'rule':{'exclude':[],'recode':{},'min':None,'max':None}}) for n in names]}

def profile(name):
    s = column(name)
    return {'missing': int(s.isna().sum()), 'unique':int(s.nunique()),
            'values':[{'value':float(k),'n':int(v)} for k,v in s.value_counts().sort_index().items()][:300],
            'min': float(s.min()) if s.notna().any() else None, 'max':float(s.max()) if s.notna().any() else None}

def fit(x, y, names, robust):
    n,k = x.shape
    if n <= k + 2:
        raise ValueError('Too few rows remain to estimate this model.')
    if np.linalg.matrix_rank(x) < k:
        raise ValueError('The model has redundant or constant predictors. Choose different variables or groups.')
    b = np.linalg.lstsq(x, y, rcond=None)[0]
    residual = y - x @ b
    inv = np.linalg.inv(x.T @ x)
    cov = inv * (residual @ residual / (n-k))
    if robust:
        xe = x * residual[:,None]
        cov = inv @ (xe.T @ xe) @ inv * n/(n-k)
    critical = t.ppf(.975, n-k)
    def contrast(weights):
        estimate = float(weights @ b)
        se = float(np.sqrt(max(0, weights @ cov @ weights)))
        p = float(2*t.sf(abs(estimate/se),n-k)) if se else (0.0 if estimate else 1.0)
        return {'estimate':estimate,'se':se,'p':p,'low':estimate-critical*se,'high':estimate+critical*se}
    coefficients = [{'term':name, **contrast(np.eye(k)[i])} for i,name in enumerate(names)]
    total = np.sum((y-y.mean())**2)
    if total == 0:
        raise ValueError('The outcome is constant after cleaning.')
    result = {'n':n,'r2':float(1-residual@residual/total),'coefficients':coefficients}
    return result, contrast

def apply_cleaning_rule(source, rule, recoded_rows=None):
    """Apply exclusions, simultaneous recodes, and bounds; count each stage."""
    s = source.replace([np.inf, -np.inf], np.nan).copy()
    missing_before = int(s.isna().sum())
    codes = [float(value) for value in rule.get('exclude', [])]
    if not all(np.isfinite(value) for value in codes):
        raise ValueError('Excluded response codes must be finite numbers.')
    excluded = s.isin(codes)
    for bounds in rule.get('exclude_ranges', []):
        if len(bounds) != 2 or not all(np.isfinite(float(v)) for v in bounds) or float(bounds[0]) > float(bounds[1]):
            raise ValueError('Exclusion ranges need two finite bounds in increasing order.')
        excluded |= s.between(float(bounds[0]), float(bounds[1]))
    code_excluded = int((s.notna() & excluded).sum())
    s = s.mask(excluded)
    mapping = {float(k):float(v) for k,v in rule.get('recode', {}).items()}
    if not all(np.isfinite(k) and np.isfinite(v) for k,v in mapping.items()):
        raise ValueError('Recode values must be finite numbers.')
    recodes = [{'from':old,'to':new,'n':int(s.eq(old).sum())} for old,new in mapping.items() if old != new]
    recoded = sum(item['n'] for item in recodes)
    if recoded_rows is not None:
        recoded_rows |= s.isin([item['from'] for item in recodes])
    s = s.replace(mapping)
    minimum, maximum = rule.get('min'), rule.get('max')
    if minimum is not None and not np.isfinite(float(minimum)) or maximum is not None and not np.isfinite(float(maximum)):
        raise ValueError('Range limits must be finite numbers.')
    if minimum is not None and maximum is not None and float(minimum) > float(maximum):
        raise ValueError('Minimum cannot be greater than maximum.')
    outside = pd.Series(False,index=s.index)
    if minimum is not None: outside |= s < float(minimum)
    if maximum is not None: outside |= s > float(maximum)
    range_excluded = int((s.notna() & outside).sum())
    s = s.mask(outside)
    return s, {'missing_before':missing_before,'code_excluded':code_excluded,'range_excluded':range_excluded,
               'excluded':code_excluded+range_excluded,'recoded':recoded,'recodes':recodes,
               'unavailable':int(s.isna().sum()),'retained':int(s.notna().sum())}

def cleaned_frame(config):
    if not isinstance(config, dict):
        raise ValueError('Model settings must be a JSON object.')
    roles = ['x','y','z','control']
    selected = [config[r] for r in roles]
    allowed = set(column_names())
    if len(set(selected)) != 4 or not set(selected) <= allowed:
        raise ValueError('Choose four different, valid variables.')
    frame = pd.DataFrame({n:column(n) for n in selected})
    audit = []
    recoded_rows = pd.Series(False,index=frame.index)
    for name in selected:
        rule = config.get('rules',{}).get(name, dictionary().get(name,{}).get('rule',{}))
        s, counts = apply_cleaning_rule(frame[name], rule, recoded_rows)
        audit.append({'variable':name, **counts})
        frame[name] = s
    return frame, audit, recoded_rows

def preview_cleaning(config):
    frame, audit, recoded_rows = cleaned_frame(config)
    complete = frame.notna().all(axis=1)
    name = config.get('preview_variable', config['y'])
    if name not in frame: raise ValueError('Choose one of the selected variables to preview.')
    before, after = column(name), frame[name]
    changed = before.notna() & (after.isna() | before.ne(after))
    examples = []
    for index in frame.index[changed][:8]:
        examples.append({'before':float(before.loc[index]),'after':float(after.loc[index]) if pd.notna(after.loc[index]) else None,
                         'retained_in_sample':bool(complete.loc[index])})
    return {'base_n':len(frame),'n':int(complete.sum()),'removed':int((~complete).sum()),'audit':audit,
            'recoded_rows':int(recoded_rows.sum()),'recoded_rows_retained':int((recoded_rows & complete).sum()),
            'recoded_rows_removed':int((recoded_rows & ~complete).sum()),'recoded_cells':sum(a['recoded'] for a in audit),
            'variable':name,'examples':examples,'config':config}

def analyze(config):
    frame, audit, _ = cleaned_frame(config)
    selected = [config[r] for r in ['x','y','z','control']]
    frame = frame.dropna()
    if len(frame) < 30:
        raise ValueError('Fewer than 30 complete rows remain. Review cleaning rules.')
    xname,yname,zname,cname = selected
    x,y,c = [frame[n].to_numpy(dtype=float) for n in [xname,yname,cname]]
    one_values = config.get('one_values',[1,2])
    d = frame[zname].isin(one_values).to_numpy(dtype=float)
    if len(np.unique(d)) != 2:
        raise ValueError('Both moderator groups must contain rows. Select some, but not all, categories for D = 1.')
    if frame[zname].nunique() > 30:
        raise ValueError('Choose a categorical moderator with at most 30 observed values.')
    control_names = [cname]
    control_columns = c[:,None]
    if config.get('control_type') == 'categorical':
        if frame[cname].nunique() > 20:
            raise ValueError('Categorical controls are limited to 20 levels. Use numeric or choose another control.')
        dummy = pd.get_dummies(frame[cname],drop_first=True,dtype=float)
        control_columns = dummy.to_numpy()
        control_names = [f'{cname}={level}' for level in dummy.columns]
    robust = config.get('se') == 'HC1'
    specs = [
        (np.column_stack([np.ones(len(x)),x]),['Intercept',xname]),
        (np.column_stack([np.ones(len(x)),x,control_columns]),['Intercept',xname]+control_names),
        (np.column_stack([np.ones(len(x)),x,d,x*d,control_columns]),['Intercept',xname,'D',f'{xname} × D']+control_names)]
    models = []
    for matrix,names in specs:
        result, contrast = fit(matrix,y,names,robust)
        models.append(result)
    weights = np.zeros(specs[2][0].shape[1]); weights[1]=1
    slopes = [{'group':'D = 0',**contrast(weights)}]
    weights[3]=1
    slopes.append({'group':'D = 1',**contrast(weights)})
    stats = [{'variable':n, 'mean':float(frame[n].mean()), 'median':float(frame[n].median()),'std':float(frame[n].std())} for n in [yname,xname,cname]]
    grouped = []
    for group in [0,1]:
        sub = pd.DataFrame({'x':x[d==group],'y':y[d==group]})
        if sub.x.nunique() <= 60:
            g = sub.groupby('x').y.agg(['mean','size']).reset_index()
        else:
            sub['bin'] = pd.qcut(sub.x,q=25,duplicates='drop')
            g = sub.groupby('bin',observed=True).agg(x=('x','mean'),mean=('y','mean'),size=('y','size')).reset_index(drop=True)
        grouped.append({'group':group,'n':len(sub),'points':[{'x':float(row.x),'y':float(row['mean']),'n':int(row['size'])} for _,row in g.iterrows()]})
    sample = frame[[xname,yname]].sample(min(1500,len(frame)),random_state=510)
    warnings = ['Unweighted observational OLS; confidence intervals do not account for BRFSS survey strata or clusters.',
                'All three models use the same complete-case sample. Audit counts overlap across variables.']
    if config.get('control_type') == 'categorical':
        warnings.append('Control descriptives summarize category codes; interpret category frequencies rather than their numerical mean.')
    for n in selected:
        if n not in dictionary():
            warnings.append(f'{n}: no dictionary rules found; review coding before interpreting results.')
    return {'n':len(frame),'base_n':len(base()[0]),'audit':audit,'models':models,'slopes':slopes,'stats':stats,'groups':grouped,
            'plot':{'x_min':float(x.min()),'x_max':float(x.max()),'control_reference':float(c.min()),'control_levels':sorted(float(v) for v in frame[cname].unique()) if config.get('control_type')=='categorical' else []},
            'scatter':[{'x':float(a),'y':float(b)} for a,b in sample.itertuples(index=False,name=None)],'warnings':warnings,'config':config}

class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):
        super().__init__(*args,directory=str(ROOT/'dist'),**kwargs)
    def send_json(self,data,status=200):
        payload=json.dumps(data,allow_nan=False).encode()
        self.send_response(status); self.send_header('Content-Type','application/json'); self.send_header('Content-Length',str(len(payload))); self.end_headers();self.wfile.write(payload)
    def do_GET(self):
        try:
            with LOCK:
                if self.path == '/api/meta': return self.send_json(metadata())
                if self.path.startswith('/api/profile/'):
                    name=self.path.rsplit('/',1)[-1]
                    if name not in set(column_names()): raise ValueError('Unknown variable.')
                    return self.send_json(profile(name))
            if self.path.startswith('/api/'): return self.send_json({'error':'Unknown endpoint'},404)
            return super().do_GET()
        except (ValueError,KeyError) as error: self.send_json({'error':str(error)},400)
    def do_POST(self):
        if self.path not in ['/api/analyze','/api/preview-cleaning']: return self.send_json({'error':'Unknown endpoint'},404)
        try:
            if int(self.headers.get('Content-Length',0)) > 100000: raise ValueError('Request too large.')
            config=json.loads(self.rfile.read(int(self.headers.get('Content-Length',0))))
            with LOCK: result=preview_cleaning(config) if self.path=='/api/preview-cleaning' else analyze(config)
            self.send_json(result)
        except (ValueError,KeyError,TypeError,np.linalg.LinAlgError) as error: self.send_json({'error':str(error)},400)

if __name__ == '__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--config');parser.add_argument('--port',type=int,default=8765);parser.add_argument('--open-browser',action='store_true');args=parser.parse_args()
    if args.config:
        print(json.dumps(analyze(json.loads(Path(args.config).read_text())),indent=2,allow_nan=False))
    else:
        print('Loading frozen notebook cohort...',flush=True);base();dictionary()
        print(f'Fieldnotes ready: http://127.0.0.1:{args.port}',flush=True)
        service = ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
        if args.open_browser:
            import webbrowser
            threading.Timer(.5,lambda:webbrowser.open(f'http://127.0.0.1:{args.port}')).start()
        service.serve_forever()
