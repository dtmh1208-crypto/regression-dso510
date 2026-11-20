"""Run with: python -m unittest discover -s playground -p test_service.py"""
import copy
import unittest
import numpy as np
from scipy.stats import linregress
import server

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

if __name__=='__main__':unittest.main()
