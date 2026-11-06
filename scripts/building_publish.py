"""Publish a completed immutable tile set before atomically switching its manifest."""
import json
import os
import re
from pathlib import Path


def publish_buildings(stage, output):
    stage, output = Path(stage), Path(output)
    version = stage.name
    if not re.fullmatch(r'buildings-[a-zA-Z0-9_-]+', version):
        raise ValueError('invalid building version')
    manifest_path = stage / 'manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    if manifest.get('format') != 'osm-building-tiles-v2' or not manifest.get('tiles'):
        raise ValueError('invalid building manifest')
    for tile in manifest['tiles']:
        tile_id = tile.get('id', '')
        if tile.get('tileSet') != version or not re.fullmatch(r'[a-zA-Z0-9_-]+', tile_id) or not (stage / 'tiles' / f'{tile_id}.json').is_file():
            raise ValueError('incomplete building tile set')
    versions = output / 'versions'
    versions.mkdir(parents=True, exist_ok=True)
    destination = versions / version
    if destination.exists():
        raise FileExistsError('building version already exists')
    # Readers of the old manifest continue to use old immutable files even if
    # interrupted before the manifest swap. Never mutate/delete old versions.
    os.replace(stage, destination)
    os.replace(destination / 'manifest.json', output / 'manifest.json')
    return destination
