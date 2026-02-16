# Dual-Trigger Implementation Summary

## What Changed

The Lambda function now responds to **BOTH** JD and resume uploads with intelligent behavior:

### Before (Single Trigger)
- ❌ Only JD uploads triggered Lambda
- ❌ Had to upload resumes first, then JD
- ❌ No way to process new resumes after JD uploaded

### After (Dual Trigger)
- ✅ Both JD and resume uploads trigger Lambda
- ✅ Upload in any order (JD first or resumes first)
- ✅ New resumes auto-processed as they arrive
- ✅ Re-upload JD to reprocess all resumes

## Lambda Behavior

```
┌─────────────────────────────────────────────────────────────┐
│                    S3 Upload Event                          │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
              Parse S3 key path
                     │
        ┌────────────┴────────────┐
        │                         │
        ▼                         ▼
   [jd folder]              [resumes folder]
        │                         │
        ▼                         ▼
  List all resumes          Find JD file
        │                         │
        ▼                         ▼
  Process ALL resumes      Process THIS resume
   (Batch mode)             (Single mode)
```

## Code Changes

### template-infrastructure.yaml
```yaml
# BEFORE: Filtered trigger
NotificationConfiguration:
  LambdaConfigurations:
    - Event: s3:ObjectCreated:*
      Filter:
        S3Key:
          Rules:
            - Name: suffix
              Value: '/jd/'
      Function: !GetAtt TriggerLambdaFunction.Arn

# AFTER: No filter (triggers on all uploads)
NotificationConfiguration:
  LambdaConfigurations:
    - Event: s3:ObjectCreated:*
      Function: !GetAtt TriggerLambdaFunction.Arn
```

### Lambda Function Logic
```python
# BEFORE: Only handled JD uploads
if parts[1] != 'jd':
    return {'statusCode': 400, 'body': 'Invalid key structure'}

# Process all resumes...

# AFTER: Handles both JD and resume uploads
folder_type = parts[1]

if folder_type == 'jd':
    # Batch process all resumes
    for resume in list_resumes():
        invoke_agentcore(resume, jd)

elif folder_type == 'resumes':
    # Process single resume
    jd = find_jd()
    if jd:
        invoke_agentcore(resume, jd)
```

## Usage Examples

### Example 1: Continuous Recruitment
```bash
# Day 1: Post job
aws s3 cp job.txt s3://bucket/SO-12345/jd/

# Day 2: First candidate
aws s3 cp resume1.pdf s3://bucket/SO-12345/resumes/  # Auto-processed

# Day 5: Second candidate
aws s3 cp resume2.pdf s3://bucket/SO-12345/resumes/  # Auto-processed

# Day 10: Third candidate
aws s3 cp resume3.pdf s3://bucket/SO-12345/resumes/  # Auto-processed
```

### Example 2: Bulk Processing
```bash
# Collect all resumes first
aws s3 cp resume1.pdf s3://bucket/SO-12345/resumes/
aws s3 cp resume2.pdf s3://bucket/SO-12345/resumes/
aws s3 cp resume3.pdf s3://bucket/SO-12345/resumes/

# Upload JD to trigger batch processing
aws s3 cp job.txt s3://bucket/SO-12345/jd/  # Processes all 3 resumes
```

### Example 3: JD Update
```bash
# Initial setup
aws s3 cp job_v1.txt s3://bucket/SO-12345/jd/job.txt
aws s3 cp resume1.pdf s3://bucket/SO-12345/resumes/
aws s3 cp resume2.pdf s3://bucket/SO-12345/resumes/

# Update JD with new requirements
aws s3 cp job_v2.txt s3://bucket/SO-12345/jd/job.txt  # Reprocesses all resumes
```

## Benefits

| Feature | Single Trigger | Dual Trigger |
|---------|---------------|--------------|
| Upload order flexibility | ❌ Resumes must be first | ✅ Any order |
| Incremental processing | ❌ No | ✅ Yes |
| Batch reprocessing | ❌ No | ✅ Yes (re-upload JD) |
| Real-time processing | ❌ No | ✅ Yes (per resume) |
| Lambda invocations | 1 per JD | 1 per upload |

## Cost Considerations

### Scenario A: 10 Resumes, Batch Upload
```
Single Trigger: 1 Lambda invocation
Dual Trigger:   1 Lambda invocation (if resumes uploaded first)
                11 Lambda invocations (if JD uploaded first)
```

### Scenario B: 10 Resumes, Incremental Upload
```
Single Trigger: Not possible
Dual Trigger:   10 Lambda invocations (1 per resume)
```

**Recommendation**: For bulk uploads, upload resumes first, then JD.

## Testing

### Test JD Upload (Batch Mode)
```bash
# Setup
aws s3 cp resume1.pdf s3://bucket/SO-TEST/resumes/
aws s3 cp resume2.pdf s3://bucket/SO-TEST/resumes/

# Trigger batch processing
aws s3 cp job.txt s3://bucket/SO-TEST/jd/

# Check logs
aws logs tail /aws/lambda/ResumeAnalyzerTrigger-agentcore --follow
# Expected: "JD uploaded: Processed 2 resumes"
```

### Test Resume Upload (Single Mode)
```bash
# Setup
aws s3 cp job.txt s3://bucket/SO-TEST/jd/

# Trigger single processing
aws s3 cp resume1.pdf s3://bucket/SO-TEST/resumes/

# Check logs
aws logs tail /aws/lambda/ResumeAnalyzerTrigger-agentcore --follow
# Expected: "Resume uploaded: Processed against SO-TEST/jd/job.txt"
```

## Files Modified

1. ✅ `template-infrastructure.yaml` - Removed S3 filter, updated Lambda code
2. ✅ `lambda_trigger.py` - Added dual-trigger logic
3. ✅ `QUICK_REFERENCE.md` - Updated with dual-trigger examples
4. ✅ `DUAL_TRIGGER_BEHAVIOR.md` - New comprehensive guide

## Deployment

No changes to deployment process:
```bash
./deploy.sh
```

The updated Lambda code is embedded in CloudFormation and will be deployed automatically.
