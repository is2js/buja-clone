import importlib.util
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch

MODULE = pathlib.Path(__file__).resolve().parents[1] / 'scripts' / 'building_publish.py'
spec = importlib.util.spec_from_file_location('building_publish', MODULE)
publish = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publish)


class BuildingPublishTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.output = pathlib.Path(self.temp.name)
        self.addCleanup(self.temp.cleanup)
        (self.output / 'manifest.json').write_text('old-manifest', encoding='utf8')
        self.stage = self.output / 'buildings-test'
        (self.stage / 'tiles').mkdir(parents=True)
        (self.stage / 'tiles' / '1_2.json').write_text('{}', encoding='utf8')
        (self.stage / 'manifest.json').write_text(json.dumps({'format':'osm-building-tiles-v2','tiles':[{'id':'1_2','tileSet':'buildings-test'}]}), encoding='utf8')

    def test_completed_version_then_manifest_swap(self):
        destination = publish.publish_buildings(self.stage, self.output)
        self.assertTrue((destination / 'tiles' / '1_2.json').is_file())
        self.assertEqual(json.loads((self.output / 'manifest.json').read_text())['tiles'][0]['tileSet'], 'buildings-test')

    def test_manifest_swap_failure_keeps_old_manifest_and_immutable_new_tiles(self):
        real_replace = publish.os.replace
        def fail_second(source, destination):
            if pathlib.Path(destination) == self.output / 'manifest.json':
                raise OSError('simulated failure')
            return real_replace(source, destination)
        with patch.object(publish.os, 'replace', side_effect=fail_second):
            with self.assertRaises(OSError): publish.publish_buildings(self.stage, self.output)
        self.assertEqual((self.output / 'manifest.json').read_text(), 'old-manifest')
        self.assertTrue((self.output / 'versions' / 'buildings-test' / 'tiles' / '1_2.json').is_file())

    def test_missing_tile_never_publishes(self):
        (self.stage / 'tiles' / '1_2.json').unlink()
        with self.assertRaises(ValueError): publish.publish_buildings(self.stage, self.output)
        self.assertEqual((self.output / 'manifest.json').read_text(), 'old-manifest')


if __name__ == '__main__': unittest.main()
