-- Canonical concept architecture artifacts for research -> strategy -> design -> image plan -> build.
ALTER TABLE prospects ADD COLUMN verified_business_profile_json TEXT;
ALTER TABLE prospects ADD COLUMN concept_strategy_json TEXT;
ALTER TABLE prospects ADD COLUMN concept_design_model_json TEXT;
ALTER TABLE prospects ADD COLUMN concept_image_plan_json TEXT;
ALTER TABLE prospects ADD COLUMN concept_architecture_version TEXT;
ALTER TABLE prospects ADD COLUMN concept_build_readiness TEXT;

ALTER TABLE concept_builds ADD COLUMN concept_strategy_json TEXT;
ALTER TABLE concept_builds ADD COLUMN concept_design_model_json TEXT;
ALTER TABLE concept_builds ADD COLUMN concept_image_plan_json TEXT;
ALTER TABLE concept_builds ADD COLUMN architecture_version TEXT;
