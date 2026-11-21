"""Run with: python -m unittest discover -s playground -p test_service.py"""
import copy
import unittest
import numpy as np
from scipy.stats import linregress
import server
import pandas as pd
from unittest.mock import patch

CONFIG={'x':'SLEPTIM1','y':'MENTHLTH','z':'EMPLOY1','control':'_AGE80','one_values':[1,2], 'control_type':'numeric','se':'OLS','rules':{}}

class RegressionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.result=server.analyze(CONFIG)

    def test_notebook_cohort_and_baseline(self):
        d,_=server.base()
        self.assertEqual(len(d),320546)
        self.assertTrue(d.MENTHLTH.between(0,30).all())
        reference=linregress(d.SLEPTIM1,d.MENTHLTH)
        c=self.result['models'][0]['coefficients'][1]
        self.assertAlmostEqual(c['estimate'],reference.slope,places=10)
        self.assertAlmostEqual(c['se'],reference.stderr,places=10)
        self.assertAlmostEqual(self.result['models'][1]['coefficients'][1]['estimate'],-.735549773966,places=9)

    def test_dictionary_codes_are_variable_specific(self):
        dictionary=server.dictionary()
        self.assertEqual(dictionary['MENTHLTH']['rule']['recode'],{'88':0})
        self.assertIn(77,dictionary['SLEPTIM1']['rule']['exclude'])
        self.assertEqual(dictionary['_AGE80']['rule']['exclude'],[])
        self.assertNotIn(9,dictionary['INCOME3']['rule']['exclude'])

    def test_cleaning_narrows_all_models_together(self):
        config=copy.deepcopy(CONFIG)
        config['rules']['_AGE80']={'exclude':[],'recode':{},'min':25,'max':64}
        result=server.analyze(config)
        age=server.column('_AGE80')
        self.assertEqual(result['n'],int(age.between(25,64).sum()))
        self.assertTrue(all(m['n']==result['n'] for m in result['models']))

    def test_interaction_slopes_and_robust_uncertainty(self):
        c=self.result['models'][2]['coefficients']
        self.assertAlmostEqual(self.result['slopes'][1]['estimate'],c[1]['estimate']+c[3]['estimate'])
        config=copy.deepcopy(CONFIG);config['se']='HC1'
        robust=server.analyze(config)
        self.assertAlmostEqual(robust['models'][1]['coefficients'][1]['estimate'],self.result['models'][1]['coefficients'][1]['estimate'])
        self.assertNotAlmostEqual(robust['models'][1]['coefficients'][1]['se'],self.result['models'][1]['coefficients'][1]['se'],places=5)

    def test_invalid_groups_rejected(self):
        config=copy.deepcopy(CONFIG);config['one_values']=[]
        with self.assertRaisesRegex(ValueError,'Both moderator groups'):
            server.analyze(config)

    def test_cleaning_counts_follow_actual_rule_order(self):
        values=pd.Series([None,77,80,88,99,5,6,7])
        cleaned,counts=server.apply_cleaning_rule(values,{'exclude':[77],'exclude_ranges':[[80,85]],'recode':{'88':0,'99':30,'5':6,'6':7},'min':0,'max':10})
        self.assertEqual(counts['missing_before'],1)
        self.assertEqual(counts['code_excluded'],2)
        self.assertEqual(counts['recoded'],4)
        self.assertEqual(counts['range_excluded'],1)
        self.assertEqual(counts['retained'],4)
        self.assertEqual(cleaned.dropna().tolist(),[0,6,7,7])
        self.assertEqual(counts['unavailable'],4)

    def test_cleaning_preview_matches_regression_sample(self):
        config=copy.deepcopy(CONFIG)
        config['rules']['_AGE80']={'exclude':[],'exclude_ranges':[[80,99]],'recode':{},'min':None,'max':None}
        config['preview_variable']='_AGE80'
        preview=server.preview_cleaning(config)
        age=server.column('_AGE80')
        self.assertEqual(preview['removed'],int(age.between(80,99).sum()))
        self.assertEqual(preview['n'],server.analyze(config)['n'])
        self.assertTrue(all(e['before']==80 and e['after'] is None for e in preview['examples']))

    def test_multi_variable_summary_counts_people_once(self):
        columns={'x':pd.Series([1,1,2,2,1,2]),'y':pd.Series([5,9,5,9,9,5]),
                 'z':pd.Series([2,2,1,2,1,1]),'c':pd.Series([80,40,80,50,40,40])}
        config={'x':'x','y':'y','z':'z','control':'c','rules':{
            'x':{'recode':{'1':3}},'y':{'recode':{'5':6}},
            'z':{'exclude':[2]},'c':{'exclude_ranges':[[80,99]]}}}
        with patch('server.column_names',return_value=list(columns)),patch('server.column',side_effect=columns.__getitem__),patch('server.dictionary',return_value={}):
            result=server.preview_cleaning(config)
        self.assertEqual(result['base_n'],6)
        self.assertEqual(result['removed'],4)  # Five variable exclusions overlap on one person.
        self.assertEqual(result['n'],2)
        self.assertEqual(result['recoded_cells'],6)
        self.assertEqual(result['recoded_rows'],5)  # One person was recoded in both X and Y.
        self.assertEqual(result['recoded_rows_retained'],2)
        self.assertEqual(result['recoded_rows_removed'],3)
        self.assertEqual(sum(a['excluded'] for a in result['audit']),5)

if __name__=='__main__':unittest.main()
