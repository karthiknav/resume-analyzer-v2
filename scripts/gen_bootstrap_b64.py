#!/usr/bin/env python3
"""Generate base64 of minimal API Lambda bootstrap zip for CloudFormation."""
import zipfile
import base64
from io import BytesIO

b = BytesIO()
with zipfile.ZipFile(b, "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("package.json", '{"type":"module"}')
    z.writestr(
        "lambda.js",
        "export const handler = async () => ({ statusCode: 200, headers: {'Content-Type':'application/json'}, body: JSON.stringify({message:'Run deploy_api_lambda.py'}) });",
    )
b.seek(0)
print(base64.b64encode(b.read()).decode())
