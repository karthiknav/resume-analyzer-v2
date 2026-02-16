# Dual Trigger Behavior

## Overview

The Lambda function now handles **both** JD and resume uploads with different behaviors:

### Trigger 1: JD Upload (Batch Processing)
```
Upload: SO-12345/jd/job_description.txt
Action: Process ALL existing resumes in SO-12345/resumes/
```

### Trigger 2: Resume Upload (Single Processing)
```
Upload: SO-12345/resumes/candidate.pdf
Action: Process THIS resume against existing JD in SO-12345/jd/
```

## Workflow Scenarios

### Scenario A: JD First, Then Resumes
```
1. Upload JD → SO-12345/jd/job.txt
   Result: No resumes yet, nothing processed

2. Upload Resume 1 → SO-12345/resumes/resume1.pdf
   Result: Processed resume1.pdf against job.txt

3. Upload Resume 2 → SO-12345/resumes/resume2.pdf
   Result: Processed resume2.pdf against job.txt
```

### Scenario B: Resumes First, Then JD
```
1. Upload Resume 1 → SO-12345/resumes/resume1.pdf
   Result: No JD yet, nothing processed

2. Upload Resume 2 → SO-12345/resumes/resume2.pdf
   Result: No JD yet, nothing processed

3. Upload JD → SO-12345/jd/job.txt
   Result: Batch process resume1.pdf AND resume2.pdf
```

### Scenario C: Mixed Uploads
```
1. Upload JD → SO-12345/jd/job.txt
   Result: No resumes yet

2. Upload Resume 1 → SO-12345/resumes/resume1.pdf
   Result: Processed resume1.pdf

3. Upload Resume 2 → SO-12345/resumes/resume2.pdf
   Result: Processed resume2.pdf

4. Upload Resume 3 → SO-12345/resumes/resume3.pdf
   Result: Processed resume3.pdf
```

## Lambda Logic

```python
def lambda_handler(event, context):
    key = event['Records'][0]['s3']['object']['key']
    # Example: "SO-12345/jd/job.txt" or "SO-12345/resumes/resume.pdf"
    
    so_folder, folder_type, filename = key.split('/')
    
    if folder_type == 'jd':
        # JD uploaded → Process ALL resumes
        resumes = list_all_resumes(so_folder)
        for resume in resumes:
            invoke_agentcore(resume, jd=key)
    
    elif folder_type == 'resumes':
        # Resume uploaded → Process THIS resume
        jd = get_jd_for_so(so_folder)
        if jd:
            invoke_agentcore(resume=key, jd=jd)
```

## Benefits

1. **Flexible Upload Order**: Upload JD or resumes first, doesn't matter
2. **Incremental Processing**: New resumes auto-processed as they arrive
3. **Batch Reprocessing**: Re-upload JD to reprocess all resumes
4. **Single Lambda**: One function handles both scenarios

## Use Cases

### Use Case 1: Continuous Recruitment
- Upload JD once
- Resumes trickle in over days/weeks
- Each resume auto-processed immediately

### Use Case 2: Bulk Upload
- Upload all resumes first
- Upload JD last to trigger batch processing
- All resumes processed in parallel

### Use Case 3: JD Update
- Re-upload updated JD
- All existing resumes reprocessed with new criteria

## Cost Optimization

**Recommended**: Upload resumes first, JD last
- Avoids duplicate processing
- Single batch invocation vs multiple individual invocations
- Lower Lambda execution time

**Example**:
```bash
# Efficient (1 Lambda invocation)
aws s3 cp resume1.pdf s3://bucket/SO-12345/resumes/
aws s3 cp resume2.pdf s3://bucket/SO-12345/resumes/
aws s3 cp resume3.pdf s3://bucket/SO-12345/resumes/
aws s3 cp job.txt s3://bucket/SO-12345/jd/  # Triggers batch

# Less efficient (4 Lambda invocations)
aws s3 cp job.txt s3://bucket/SO-12345/jd/  # Triggers (0 resumes)
aws s3 cp resume1.pdf s3://bucket/SO-12345/resumes/  # Triggers
aws s3 cp resume2.pdf s3://bucket/SO-12345/resumes/  # Triggers
aws s3 cp resume3.pdf s3://bucket/SO-12345/resumes/  # Triggers
```
