ALTER TABLE prospects ADD COLUMN verified_business_profile_json TEXT;
ALTER TABLE prospects ADD COLUMN concept_strategy_json TEXT;
ALTER TABLE prospects ADD COLUMN concept_design_model_json TEXT;
ALTER TABLE prospects ADD COLUMN concept_image_plan_json TEXT;
ALTER TABLE prospects ADD COLUMN concept_architecture_version TEXT;
ALTER TABLE prospects ADD COLUMN concept_build_readiness TEXT;
ALTER TABLE prospects ADD COLUMN design_spec_json TEXT;
ALTER TABLE prospects ADD COLUMN design_spec_version TEXT;
ALTER TABLE prospects ADD COLUMN design_spec_updated_at TEXT;

ALTER TABLE concept_builds ADD COLUMN design_spec_json TEXT;
ALTER TABLE concept_builds ADD COLUMN design_spec_version TEXT;
ALTER TABLE concept_builds ADD COLUMN concept_strategy_json TEXT;
ALTER TABLE concept_builds ADD COLUMN concept_design_model_json TEXT;
ALTER TABLE concept_builds ADD COLUMN concept_image_plan_json TEXT;
ALTER TABLE concept_builds ADD COLUMN architecture_version TEXT;
