import csv
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts'))
from transaction_quality import month_error, district_drop_errors


class TransactionQualityTest(unittest.TestCase):
    def test_partial_month_with_failed_mapping_or_values_is_rejected(self):
        self.assertIn('미연계', month_error(['202610'], {'202610': {'accepted': 25, 'unmatched': 5, 'validValue': 25}}))
        self.assertIn('유효', month_error(['202610'], {'202610': {'accepted': 25, 'validValue': 0}}))
        self.assertIsNone(month_error(['202610'], {'202610': {'accepted': 25, 'validValue': 25}}))

    def test_compares_identical_months_and_detects_missing_district(self):
        previous = {'months':['202609','202610'], 'byRegion': {'gu:11110': {'monthlyCounts':[100,50]}}}
        good = {'gu:11110': {'monthlyCounts':[45,20]}}
        self.assertEqual(district_drop_errors(previous, good, ['202610','202611']), [])
        bad = {'gu:11110': {'monthlyCounts':[4,20]}}
        self.assertEqual(len(district_drop_errors(previous, bad, ['202610','202611'])), 1)
        self.assertEqual(len(district_drop_errors(previous, {}, ['202610','202611'])), 1)

    def test_failure_preserves_old_snapshot(self):
        regions = json.loads((ROOT/'public/data/legal.json').read_text(encoding='utf-8'))['regions']
        address = {area: next(x['full'] for x in regions if x['area'] == area) for area in ('11','41')}
        months = [f'{2025 if i < 2 else 2026}{11+i if i < 2 else i-1:02d}' for i in range(12)]
        with tempfile.TemporaryDirectory() as directory:
            folder=pathlib.Path(directory)
            for prefix in ('11000','41000'):
                for kind in ('apt-sale','apt-rent','commercial-sale'):
                    area='11' if prefix == '11000' else '41'
                    area_col='전용/연면적(㎡)' if kind == 'commercial-sale' else '전용면적(㎡)'
                    amount_col='보증금(만원)' if kind == 'apt-rent' else '거래금액(만원)'
                    columns=['NO','시군구','계약년월',area_col,amount_col]
                    if kind == 'apt-rent': columns += ['전월세구분','월세금(만원)']
                    with (folder/f'{prefix}-{kind}.csv').open('w', encoding='cp949', newline='') as file:
                        writer=csv.DictWriter(file, fieldnames=columns); writer.writeheader()
                        for month in months:
                            for index in range(25):
                                row={'NO':str(index),'시군구':address[area], '계약년월':month, area_col:'84', amount_col:'10000'}
                                if kind == 'apt-rent': row.update({'전월세구분':'전세','월세금(만원)':'0'})
                                if prefix == '11000' and kind == 'apt-sale' and month == '202610':
                                    row['시군구']='서울특별시 가짜구 가짜동'
                                writer.writerow(row)
            output=folder/'existing.json'; output.write_text('{"sentinel":"original"}',encoding='utf-8')
            process=subprocess.run([sys.executable,str(ROOT/'scripts/aggregate-transactions.py'),str(folder),'--as-of','2026-10','--output',str(output)],capture_output=True,text=True,encoding='utf-8',env={**os.environ,'PYTHONIOENCODING':'utf-8'})
            self.assertNotEqual(process.returncode,0,process.stderr)
            self.assertIn('기존 결과를 보존',process.stderr)
            self.assertEqual(json.loads(output.read_text(encoding='utf-8')),{'sentinel':'original'})
            source = folder/'11000-apt-sale.csv'
            source.write_text(source.read_text(encoding='cp949').replace('서울특별시 가짜구 가짜동',address['11']),encoding='cp949')
            process=subprocess.run([sys.executable,str(ROOT/'scripts/aggregate-transactions.py'),str(folder),'--as-of','2026-10','--output',str(output)],capture_output=True,text=True,encoding='utf-8',env={**os.environ,'PYTHONIOENCODING':'utf-8'})
            self.assertEqual(process.returncode,0,process.stderr)
            diagnostic=json.loads(output.read_text(encoding='utf-8'))['diagnostics']['11000-apt-sale.csv']
            self.assertEqual(diagnostic['byMonth']['202610']['validValue'],25)
            self.assertEqual(len(diagnostic['inputSha256']),64)


if __name__ == '__main__': unittest.main()
