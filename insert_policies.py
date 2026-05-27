import csv
import os
import sys
from datetime import datetime
import re
import json

try:
    from supabase import create_client
except ImportError:
    os.system(f'{sys.executable} -m pip install supabase -q')
    from supabase import create_client

# ── Config — load from .env.local or .vercel/.env.development.local ──
def load_env_file(path):
    if not os.path.exists(path):
        return
    with open(path, 'r') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, _, val = line.partition('=')
            os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))

script_dir = os.path.dirname(os.path.abspath(__file__))
load_env_file(os.path.join(script_dir, '.env.local'))
load_env_file(os.path.join(script_dir, '.vercel', '.env.development.local'))

SUPABASE_URL = os.environ.get('VITE_SUPABASE_URL') or input('Enter your Supabase URL: ').strip()
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY') or input('Enter your service role key: ').strip()
CSV_PATH = r'C:\Users\awatt\Downloads\Master Data Set - WFA - Apps and Policies.csv'
BATCH_SIZE = 500
TRUNCATE_FIRST = True   # set False to skip truncation

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

if TRUNCATE_FIRST:
    print('Truncating existing rows...')
    supabase.table('policies').delete().neq('id', '00000000-0000-0000-0000-000000000000').execute()
    print('Truncated.')

def parse_date(val):
    if not val or str(val).strip() in ['', 'nan', 'NaT', 'None']:
        return None
    try:
        d = datetime.strptime(str(val).strip(), '%m/%d/%Y')
        return d.strftime('%Y-%m-%d')
    except:
        try:
            d = datetime.strptime(str(val).strip(), '%Y-%m-%d')
            return d.strftime('%Y-%m-%d')
        except:
            return None

def parse_snapshot_month(val):
    if not val or str(val).strip() in ['', 'nan']:
        return None
    months = {'January':1,'February':2,'March':3,'April':4,'May':5,'June':6,
              'July':7,'August':8,'September':9,'October':10,'November':11,'December':12}
    for month, num in months.items():
        if month in str(val):
            try:
                year = int(re.search(r'(\d{4})', str(val)).group(1))
                return f'{year:04d}-{num:02d}-01'
            except:
                pass
    return parse_date(val)

def parse_num(val):
    if not val or str(val).strip() in ['', 'nan']:
        return None
    try:
        return float(str(val).replace(',','').replace('$','').strip())
    except:
        return None

def parse_bool(val):
    if not val or str(val).strip() in ['', 'nan']:
        return False
    return str(val).strip().lower() in ['true', '1', 'yes', 'x']

def parse_str(val):
    if not val or str(val).strip() in ['', 'nan', 'NaT', 'None']:
        return None
    return str(val).strip()

# Read CSV and build rows
print(f'Reading {CSV_PATH}...')
rows = []
with open(CSV_PATH, 'r', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for row in reader:
        # Skip entirely null rows
        if not row.get('Status') and not row.get('Submit Date') and not row.get('Applicant'):
            continue
        
        record = {
            'status': parse_str(row.get('Status')),
            'submit_date': parse_date(row.get('Submit Date')),
            'issue_date': parse_date(row.get('Issue Date')),
            'applicant': parse_str(row.get('Applicant')),
            'sfg_id': parse_str(row.get('SFG ID')),
            'policy_number': parse_str(row.get('Policy No')),
            'carrier': parse_str(row.get('Carrier')),
            'policy_name': parse_str(row.get('Policy')),
            'face_amount': parse_num(row.get('FaceAmt')),
            'submitted_apv': parse_num(row.get('Submitted APV')),
            'issued_apv': parse_num(row.get('Issued APV')),
            'not_in_opt': parse_bool(row.get('Not in Opt')),
            'split_reset': parse_bool(row.get('Split/Reset')),
            'last_update': parse_date(row.get('Last Update')),
            'application_notes': parse_str(row.get('Application Notes')),
            'policy_notes': parse_str(row.get('Policy Notes')),
            'conservation_status': parse_str(row.get('Conservation Status')),
            'conservation_date': parse_date(row.get('Conservation Date (Expected/Actual)')),
            'snapshot_chargeback_month': parse_snapshot_month(row.get('Snapshot Chargeback Month')),
            'snapshot_chargeback_apv': parse_num(row.get('Snapshot Chargeback APV')),
            'chargeback_exempt': parse_bool(row.get('Not reported')),
            'subtype': parse_str(row.get('Subtype')),
            'status_actual': parse_str(row.get('Status (actual)')),
            'status_12mo': parse_str(row.get('12 mo status')),
            # Additional fields not in original insert
            'submit_week': parse_date(row.get('Submit Week')),
            'submit_week_num': parse_str(row.get('Submit Week #')),
        }
        
        # Only include rows with at least a status or applicant
        if record['status'] or record['applicant']:
            rows.append(record)

print(f'Found {len(rows)} valid rows to insert')
print(f'Inserting in batches of {BATCH_SIZE}...')

inserted = 0
errors = 0

for i in range(0, len(rows), BATCH_SIZE):
    batch = rows[i:i+BATCH_SIZE]
    batch_num = (i // BATCH_SIZE) + 1
    total_batches = (len(rows) + BATCH_SIZE - 1) // BATCH_SIZE
    
    try:
        result = supabase.table('policies').insert(batch).execute()
        inserted += len(batch)
        print(f'Batch {batch_num}/{total_batches}: {len(batch)} rows inserted ({inserted} total)')
    except Exception as e:
        errors += len(batch)
        print(f'Batch {batch_num}/{total_batches}: ERROR - {str(e)[:100]}')

print()
print(f'Done. Inserted: {inserted}, Errors: {errors}')
