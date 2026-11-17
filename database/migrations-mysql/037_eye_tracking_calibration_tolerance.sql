UPDATE module_templates
SET structure = JSON_REMOVE(
  structure,
  JSON_UNQUOTE(REPLACE(JSON_SEARCH(structure, 'one', 'calibration-failure-action', NULL, '$.components[*].id'), '.id', ''))
)
WHERE name = 'Eye Tracking'
  AND JSON_SEARCH(structure, 'one', 'calibration-failure-action', NULL, '$.components[*].id') IS NOT NULL;

UPDATE module_templates
SET structure = JSON_ARRAY_APPEND(
  structure,
  '$.components',
  JSON_OBJECT(
    'id', 'calibration-tolerance',
    'type', 'radio',
    'label', 'Calibration tolerance',
    'value', 'medium',
    'order', 11,
    'hidden', true
  )
)
WHERE name = 'Eye Tracking'
  AND JSON_SEARCH(structure, 'one', 'calibration-tolerance', NULL, '$.components[*].id') IS NULL;
