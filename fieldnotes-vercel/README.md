# Fieldnotes · DSO 510 regression playground

For Vercel + Supabase hosting, follow [DEPLOYMENT.md](DEPLOYMENT.md). `release/` contains the folder-preserving GitHub ZIP, the separate compressed Supabase dataset, and upload instructions. Generated dependencies and caches can be restored with `npm install` when needed; the local launcher uses the retained compiled `dist/` build.

A local React + TypeScript interface with a Python/pandas/SciPy regression service. The page uses the supplied CSV and codebook ZIP from the parent folder. No data is uploaded.

## Open the app

Double-click `Start Playground.cmd`, then visit http://127.0.0.1:8765. Keep its terminal running while using the page. Close the terminal to stop the app.

If the interface needs to be rebuilt, run these commands from this folder:

```
npm install
npm run build
python server.py
```

Python requires numpy, pandas, and scipy. These are already installed in the current workspace's Python environment. The compiled `dist` folder lets the app run without npm after building.

For frontend development: `python server.py` in one terminal and `npm run dev` in another. Vite proxies `/api` to the Python service.

Validation: `npm test` runs the data and regression tests. `npm run build` includes TypeScript checking. The current build was served successfully over HTTP, including a categorical-control/HC1 regression request. Automated browser interaction could not run in this restricted environment, so visual behavior should be reviewed in your browser.

## Sample and cleaning

The starting cohort exactly matches `EDA + Model.ipynb`: recode MENTHLTH 88 to 0 and retain MENTHLTH 0–30, SLEPTIM1 1–24, and EMPLOY1 1–8. This retains 320,546 of 356,158 rows. Selecting other variables never restores excluded rows. The three original variables retain their notebook-cleaned values.

Dictionary suggestions exclude numeric codes labeled don't know, refused, missing, or not asked, and recode 88 to zero only when its variable-specific label is None. Review the actual codebook entries before using a new variable: automatic suggestions cannot understand every special coding scheme, implied decimal, skip pattern, or multi-field measurement. Select continuous numeric X/Y and a meaningful categorical Z; identifier columns are unsuitable predictors.

Extra cleaning is applied independently per selected variable: exclude codes, recode, then apply minimum/maximum. Blank/unavailable values are dropped. All three regressions use the same complete-case sample over X, Y, Z, and control. Audit counts may overlap across columns. Numeric controls use a linear term. Categorical controls use dummy variables with the smallest observed code as the reference group (up to 20 levels). The moderator must have at most 30 levels; selected codes form D=1 and all other valid codes form D=0.

In Clean & inspect, select a variable tab, edit rules, then choose **Apply & preview cleaning**. Exclusions accept individual numeric codes and inclusive numeric ranges, e.g. `77, 80-99` or `"80 - 99"`. Codebook range labels are not literal string responses. Literal text categories require numeric encoding and are rejected by this numeric-rule editor. Recode syntax is `old:new`, e.g. `88:0`; it changes values rather than column names.

The preview does not run regressions. It reports missing, code/range exclusions, actual recode counts with old/new mappings, min/max exclusions, and combined complete cases across all four variables. Recode counts precede min/max and complete-case removal; a changed row may still be excluded later. Reapplying rules recomputes from the frozen cohort, rather than applying recodes repeatedly. Unapplied drafts persist when switching tabs or returning to Variables, and models cannot run until pending edits are applied. The Back to Variables button is available at both ends of the cleaning panel.

The main workflow has four steps: Variables, Preview Data before Regression, Regressions, and Saved experiments. Clean & Inspect is an optional subpage of Variables, opened from an individual variable card or its optional sidebar sub-tab. While cleaning is open, preview, regression, and experiment navigation are disabled and the global model/next action bar is hidden. Apply or inspect rules, then use Back to Variables to continue; cleaning has no direct next/run action.

Preview Data before Regression automatically displays a model-independent cleaning summary, even before the first regression. Each variable has its own row with applied rules and counts. Use Back to Variables if you want to open optional cleaning again. Combined removed and recoded respondent counts are deduplicated across variables. The summary also distinguishes changed cells from changed respondents, and recoded respondents retained versus excluded later. Unapplied drafts are explicitly excluded from the saved-rules summary; the Run button stays disabled until they are applied. Descriptive charts from an earlier model run remain labeled as stale when settings change.

OLS coefficients use least squares. Standard errors are conventional OLS by default, optionally HC1. Two-sided p-values and 95% confidence intervals use the residual degrees of freedom and Student t distribution. Model 3 group slopes and intervals use covariance-aware linear contrasts. Constant/redundant designs are rejected. In a very large sample, very small p-values may underflow to numerical zero; the interface displays these as <0.001.

This is unweighted exploratory regression: BRFSS sampling weights, strata, and clusters are not incorporated. Nonlinearity, reverse causation, omitted variables, and cohort selection remain limitations. Plots disclose sampling/binning; model fitting uses every complete row.

## Reproduce an experiment

Download `experiment.json` from a regression result, then run:

```
python server.py --config experiment.json > experiment-results.json
```

Saved experiments stay in this browser's local storage (latest 12), including their settings and outputs. Download settings for a portable record. CSV export includes all coefficients from all three models.

## Equations, interpretations, and fitted lines

Each result (including a loaded saved experiment) displays the full fitted equations for all three models, Model 3 equations simplified separately for D=0 and D=1, and an interpretation of the baseline slope, control adjustment, and moderation. Categorical controls are expanded into indicator terms relative to the omitted category. Download the equations and interpretation as Markdown from the result exports.

The regression-line graph can show one model or all models together. Model 3 always has two lines. Adjusted predictions hold numeric controls at a selectable value (initially the analysis-sample mean) or categorical controls at a selectable category (initially the omitted reference). Changing this value only changes predictions; it does not refit the models. Optional dots show the stored display sample. Lines are point predictions without confidence bands. Saved experiments created before plot metadata was added use their stored display-sample X range; rerun them to use the full analysis-sample X range.
