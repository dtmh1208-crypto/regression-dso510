import copy
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import URLError, HTTPError
from urllib.request import Request, urlopen
from http.server import ThreadingHTTPServer

import data_access
import server
from api_service import ApiHandler, route_request

CONFIG={'x':'SLEPTIM1','y':'MENTHLTH','z':'EMPLOY1','control':'_AGE80','one_values':[1,2],'control_type':'numeric','se':'OLS','rules':{}}

def clear_data_caches():
    for function in [data_access.dataset_path,server.base,server.column,server.column_names]:
        function.cache_clear()

class HostingTests(unittest.TestCase):
    def setUp(self):
        self.environment=patch.dict(os.environ,{'DATASET_MODE':'raw'})
        self.environment.start()
        clear_data_caches()

    def tearDown(self):
        clear_data_caches()
        self.environment.stop()

    def test_prepared_dataset_matches_original_models(self):
        original=server.analyze(copy.deepcopy(CONFIG))
        os.environ['DATASET_MODE']='prepared'
        clear_data_caches()
        prepared=server.analyze(copy.deepcopy(CONFIG))
        self.assertEqual(prepared['n'],320546)
        self.assertEqual(len(server.column_names()),len(data_access.manifest()['columns']))
        self.assertEqual(server.metadata()['raw_n'],356158)
        for before,after in zip(original['models'],prepared['models']):
            for left,right in zip(before['coefficients'],after['coefficients']):
                self.assertAlmostEqual(left['estimate'],right['estimate'],places=9)
                self.assertAlmostEqual(left['se'],right['se'],places=9)

    def test_metadata_does_not_download_the_dataset(self):
        os.environ['DATASET_MODE']='supabase'
        with patch('data_access.urlopen',side_effect=AssertionError('No network expected')):
            result=server.metadata()
        self.assertEqual(result['base_n'],320546)

    def test_private_download_integrity_and_warm_cache(self):
        content=b'a small compressed dataset fixture'
        info={'object_name':'brfss-fixture.csv.gz','compressed_bytes':len(content),'sha256':hashlib.sha256(content).hexdigest()}
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ,{'DATASET_MODE':'supabase','SUPABASE_URL':'https://example.supabase.co','SUPABASE_SERVICE_ROLE_KEY':'backend-test-key'}), patch('data_access.manifest',return_value=info), patch('data_access.tempfile.gettempdir',return_value=folder), patch('data_access.urlopen',return_value=io.BytesIO(content)) as network:
            path=data_access.dataset_path()
            self.assertEqual(path.read_bytes(),content)
            self.assertEqual(data_access.dataset_path(),path)
            self.assertEqual(network.call_count,1)
            request=network.call_args.args[0]
            self.assertIn('/storage/v1/object/authenticated/fieldnotes-data/',request.full_url)
            self.assertEqual(request.get_header('Authorization'),'Bearer backend-test-key')

    def test_corrupt_download_is_not_cached(self):
        info={'object_name':'test.csv.gz','compressed_bytes':3,'sha256':hashlib.sha256(b'yes').hexdigest()}
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ,{'SUPABASE_URL':'https://example.supabase.co','SUPABASE_SERVICE_ROLE_KEY':'backend-test-key'}), patch('data_access.manifest',return_value=info), patch('data_access.urlopen',return_value=io.BytesIO(b'bad')):
            destination=Path(folder)/'test.csv.gz'
            with self.assertRaisesRegex(RuntimeError,'integrity check'):
                data_access.download_dataset(destination)
            self.assertFalse(destination.exists())
            self.assertEqual(list(Path(folder).iterdir()),[])

    def test_network_error_does_not_disclose_key(self):
        info={'object_name':'test.csv.gz','compressed_bytes':3,'sha256':'unused'}
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ,{'SUPABASE_URL':'https://example.supabase.co','SUPABASE_SERVICE_ROLE_KEY':'sensitive-test-key'}), patch('data_access.manifest',return_value=info), patch('data_access.urlopen',side_effect=URLError('sensitive-test-key')):
            with self.assertRaises(RuntimeError) as raised:
                data_access.download_dataset(Path(folder)/'test.csv.gz')
            self.assertNotIn('sensitive-test-key',str(raised.exception))

    def test_http_adapter_handles_rewrite_and_invalid_payload(self):
        service=ThreadingHTTPServer(('127.0.0.1',0),ApiHandler)
        thread=threading.Thread(target=service.serve_forever,daemon=True);thread.start()
        try:
            root=f'http://127.0.0.1:{service.server_port}'
            with urlopen(root+'/api/index?route=health') as response:
                self.assertEqual(json.load(response)['status'],'ready')
                self.assertEqual(response.headers['Cache-Control'],'no-store')
            request=Request(root+'/api/index?route=analyze',data=b'not JSON',headers={'Content-Type':'application/json'})
            with self.assertRaises(HTTPError) as raised:urlopen(request)
            self.assertEqual(raised.exception.code,400)
            self.assertIn('error',json.load(raised.exception))
            status,_=route_request('GET','/api/index?route=does-not-exist')
            self.assertEqual(status,404)
        finally:
            service.shutdown();service.server_close();thread.join()

if __name__=='__main__':unittest.main()
