CREATE TABLE IF NOT EXISTS consent_records (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    research_id CHAR(36) NOT NULL,
    subject_id VARCHAR(255) NOT NULL,
    context ENUM('eye_tracking', 'emotion_analysis', 'website_tracking') NOT NULL,
    decision ENUM('accepted', 'declined', 'withdrawn') NOT NULL,
    consent_text TEXT NOT NULL,
    consent_text_sha256 CHAR(64) NOT NULL,
    locale VARCHAR(16) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_consent_records_research_subject (research_id, subject_id),
    CONSTRAINT consent_records_research_fk FOREIGN KEY (research_id) REFERENCES researches (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
