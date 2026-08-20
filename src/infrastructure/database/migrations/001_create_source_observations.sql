CREATE TABLE source_observations (
    id TEXT PRIMARY KEY,

    source_type TEXT NOT NULL,
    source_name TEXT NOT NULL,
    source_url TEXT,
    external_id TEXT,
    provider_metadata_json TEXT,

    observed_at TEXT NOT NULL,
    published_at TEXT,

    title TEXT,
    displayed_company_name TEXT,
    location_text TEXT,
    description TEXT,
    salary_text TEXT,
    contract_text TEXT,
    contact_text TEXT,

    raw_content TEXT,
    metadata_json TEXT NOT NULL
);
