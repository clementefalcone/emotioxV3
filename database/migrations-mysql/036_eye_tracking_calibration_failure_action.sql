UPDATE module_templates
SET structure = JSON_ARRAY_APPEND(
  structure,
  '$.components',
  JSON_OBJECT(
    'id', 'calibration-failure-action',
    'type', 'radio',
    'label', 'Calibration failure action',
    'value', 'disqualify-study',
    'order', 11,
    'hidden', true
  )
)
WHERE name = 'Eye Tracking'
  AND NOT JSON_CONTAINS(JSON_EXTRACT(structure, '$.components[*].id'), '"calibration-failure-action"');
