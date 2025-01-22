import json
import sqlite3

map = {
  'million': 6,
  'billion': 9,
  'm': 6,
  'b': 9,
}

def good_and_gather(jsonl_file_path):
  s1 = open(f"data/{jsonl_file_path}", 'r', encoding='utf-8')
  conn = sqlite3.connect('cardingser.db')
  cur = conn.cursor()

  create_tables_sql = f'''
CREATE TABLE IF NOT EXISTS {jsonl_file_path.split('_')[1].split('.')[0]} (
      id INTEGER,
      name TEXT,
      type TEXT,
      motto TEXT,
      category TEXT,
      region TEXT,
      flag TEXT,
      cardcategory TEXT,
      population INTEGER,
      description TEXT,
      badges TEXT,
      trophies TEXT,
      PRIMARY KEY (id)
  )
  '''

  cur.executescript(create_tables_sql)

  for line in s1:
    json_data = json.loads(line)

    if (json_data['DESCRIPTION']):
      population = ' '.join(json_data['DESCRIPTION'].split()[0:2])
      if 'b Population' in population:
        population = population.replace ('b Population', ' billion')
      elif 'm Population' in population:
        population = population.replace('m Population', ' million')

      quantifier = population.split(' ')[1]
      popular = float(population.split(' ')[0])
      factor = 10 ** map[quantifier]

      popsa = int(popular * factor)
    else:
      popsa = None

    cur.execute(f'''
      INSERT OR IGNORE INTO {jsonl_file_path.split('_')[1].split('.')[0]} (id, name, type, motto, category, region, flag, cardcategory, population, description, badges, trophies)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ''', (json_data['ID'], json_data['NAME'], json_data['TYPE'], json_data['MOTTO'], json_data['CATEGORY'], json_data['REGION'], json_data['FLAG'], json_data['CARDCATEGORY'], popsa, json_data['DESCRIPTION'], json.dumps(json_data['BADGES']), json.dumps(json_data['TROPHIES'])))

  conn.commit()
  conn.close()

good_and_gather('cardlist_S1.jsonl')
good_and_gather('cardlist_S2.jsonl')
good_and_gather('cardlist_S3.jsonl')
good_and_gather('cardlist_S4.jsonl')