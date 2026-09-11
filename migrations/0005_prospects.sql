CREATE TABLE IF NOT EXISTS prospects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_name TEXT NOT NULL,
  category TEXT,
  city TEXT,
  state TEXT,
  concept_url TEXT,
  stage TEXT NOT NULL DEFAULT 'Qualified',
  qualification TEXT,
  website_gate TEXT,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  call_attempts INTEGER NOT NULL DEFAULT 0,
  decision_maker_reached INTEGER NOT NULL DEFAULT 0,
  concept_viewed INTEGER NOT NULL DEFAULT 0,
  next_follow_up TEXT,
  outcome TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_prospects_stage ON prospects(stage);
CREATE INDEX IF NOT EXISTS idx_prospects_business ON prospects(business_name);

INSERT INTO prospects (business_name,category,city,state,concept_url,stage,qualification,website_gate)
SELECT 'Therapeutic Massage','Massage / Wellness','Luling','LA','https://therapeutic-massage.cajunsites.com','Concept Built','A','No website listed'
WHERE NOT EXISTS (SELECT 1 FROM prospects WHERE business_name='Therapeutic Massage');
INSERT INTO prospects (business_name,category,city,state,concept_url,stage,qualification,website_gate)
SELECT 'Follicle Hair Solutions','Hair Restoration / Salon','Luling','LA','https://follicle-hair-solutions.cajunsites.com','Concept Built','A+','No website listed'
WHERE NOT EXISTS (SELECT 1 FROM prospects WHERE business_name='Follicle Hair Solutions');
INSERT INTO prospects (business_name,category,city,state,concept_url,stage,qualification,website_gate)
SELECT 'We''re All-En Learning Center','Childcare','Luling','LA','https://were-all-en-learning-center.cajunsites.com','Concept Built','A+','No website listed'
WHERE NOT EXISTS (SELECT 1 FROM prospects WHERE business_name='We''re All-En Learning Center');
INSERT INTO prospects (business_name,category,city,state,concept_url,stage,qualification,website_gate)
SELECT 'DKE Cleaning Services LLC','Cleaning Services','Luling','LA','https://dke-cleaning-services.cajunsites.com','Concept Built','A','No website listed'
WHERE NOT EXISTS (SELECT 1 FROM prospects WHERE business_name='DKE Cleaning Services LLC');
INSERT INTO prospects (business_name,category,city,state,concept_url,stage,qualification,website_gate)
SELECT 'Divaology Hair Studio','Hair Salon','Luling','LA','https://divaology-hair-studio.cajunsites.com','Concept Built','A','No website listed'
WHERE NOT EXISTS (SELECT 1 FROM prospects WHERE business_name='Divaology Hair Studio');
INSERT INTO prospects (business_name,category,city,state,concept_url,stage,qualification,website_gate)
SELECT 'The Diesel Lab LLC','Diesel Repair','Boutte','LA','https://the-diesel-lab.cajunsites.com','Concept Built','A','No website listed'
WHERE NOT EXISTS (SELECT 1 FROM prospects WHERE business_name='The Diesel Lab LLC');
INSERT INTO prospects (business_name,category,city,state,concept_url,stage,qualification,website_gate)
SELECT 'Up to Code Plumbing','Plumbing','Boutte','LA','https://up-to-code-plumbing.cajunsites.com','Concept Built','A','No website listed'
WHERE NOT EXISTS (SELECT 1 FROM prospects WHERE business_name='Up to Code Plumbing');
INSERT INTO prospects (business_name,category,city,state,concept_url,stage,qualification,website_gate)
SELECT 'Southern Classic Automotives','Auto Repair','Boutte','LA','https://southern-classic-automotives.cajunsites.com','Concept Built','A','No website listed'
WHERE NOT EXISTS (SELECT 1 FROM prospects WHERE business_name='Southern Classic Automotives');
INSERT INTO prospects (business_name,category,city,state,stage,qualification,website_gate)
SELECT 'B''s Towing Services & Roadside Assistance','Towing / Roadside','Luling','LA','Concept Built','A+','No website listed'
WHERE NOT EXISTS (SELECT 1 FROM prospects WHERE business_name='B''s Towing Services & Roadside Assistance');
INSERT INTO prospects (business_name,category,city,state,stage,qualification,website_gate)
SELECT 'Sudz Sation','Car Wash','Luling','LA','Concept Built','A','No website listed'
WHERE NOT EXISTS (SELECT 1 FROM prospects WHERE business_name='Sudz Sation');
INSERT INTO prospects (business_name,category,city,state,stage,qualification,website_gate)
SELECT 'Beck''s Automotive','Auto Repair','Luling','LA','Concept Built','A','No website listed'
WHERE NOT EXISTS (SELECT 1 FROM prospects WHERE business_name='Beck''s Automotive');
INSERT INTO prospects (business_name,category,city,state,stage,qualification,website_gate)
SELECT 'Rapid Automotive Services','Auto Repair','Luling','LA','Concept Built','A','No website listed'
WHERE NOT EXISTS (SELECT 1 FROM prospects WHERE business_name='Rapid Automotive Services');
