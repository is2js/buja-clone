import importlib.util
from pathlib import Path
import unittest

source = Path(__file__).resolve().parents[1] / 'scripts' / 'prepare-vworld-candidate.py'
spec = importlib.util.spec_from_file_location('vworld_candidate', source)
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


def feature(fid='101', height='23', levels='5', geometry=None):
    return {'type': 'Feature', 'id': fid,
            'geometry': geometry or {'type': 'Polygon', 'coordinates': [[[127, 37.4], [127.01, 37.4], [127.01, 37.41], [127, 37.4]]]},
            'properties': {'measured': height, 'floor_count': levels, 'name': '자료 예시', 'unrelated_secret': 'do-not-copy'}}


def run(features):
    return adapter.normalize_collection({'type': 'FeatureCollection', 'features': features}, id_field=None,
                                        name_field='name', height_field='measured', levels_field='floor_count', as_of='2026-11-05')


class CandidateTest(unittest.TestCase):
    def test_source_height_wins_and_unrelated_fields_not_copied(self):
        result = run([feature()])
        props = result['features'][0]['properties']
        self.assertEqual((props['height'], props['heightSource']), (23, 'height'))
        self.assertNotIn('unrelated_secret', str(result))
        self.assertFalse(result['metadata']['automaticallyPublished'])

    def test_floor_estimate_and_no_height_omission(self):
        result = run([feature('one', None, 5), feature('two', None, None)])
        self.assertEqual(result['features'][0]['properties']['height'], 15)
        self.assertEqual(result['features'][0]['properties']['heightSource'], 'levels')
        self.assertEqual(result['metadata']['statistics']['missingHeight'], 1)

    def test_duplicate_ids_are_not_merged(self):
        with self.assertRaisesRegex(ValueError, '중복'):
            run([feature(), feature()])

    def test_bad_geometry_or_projected_coordinates_do_not_produce_output(self):
        with self.assertRaisesRegex(ValueError, '유효한 건물'):
            run([feature(geometry={'type': 'Polygon', 'coordinates': [[[200000, 500000], [200001, 500000], [200001, 500001], [200000, 500000]]]})])

    def test_declared_non_wgs84_is_refused(self):
        with self.assertRaisesRegex(ValueError, '좌표계'):
            adapter.normalize_collection({'type': 'FeatureCollection', 'features': [feature()], 'crs': {'properties': {'name': 'EPSG:5179'}}},
                                         id_field=None, name_field=None, height_field='measured', levels_field=None, as_of='2026-11-05')


if __name__ == '__main__':
    unittest.main()
