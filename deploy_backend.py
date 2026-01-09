import boto3
import json
import time
import zipfile
import io
import os
import argparse

def get_role_arn(iam, role_name):
    try:
        role = iam.get_role(RoleName=role_name)
        return role['Role']['Arn']
    except iam.exceptions.NoSuchEntityException:
        return None

def create_lambda_role(iam, role_name):
    print(f"Creating IAM Role: {role_name}...")
    trust_policy = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Principal": {"Service": "lambda.amazonaws.com"},
                "Action": "sts:AssumeRole"
            }
        ]
    }

    try:
        role = iam.create_role(
            RoleName=role_name,
            AssumeRolePolicyDocument=json.dumps(trust_policy)
        )

        # Attach basic execution permission
        iam.attach_role_policy(
            RoleName=role_name,
            PolicyArn='arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'
        )

        # Attach DynamoDB Full Access (Simplify for dev, scope down for prod ideally)
        iam.attach_role_policy(
            RoleName=role_name,
            PolicyArn='arn:aws:iam::aws:policy/AmazonDynamoDBFullAccess'
        )

        print("Waiting for Role propagation...")
        time.sleep(10) # Important
        return role['Role']['Arn']

    except Exception as e:
        print(f"Error creating role: {e}")
        # If exists, return ARN
        return get_role_arn(iam, role_name)

def create_zip(source_dir):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        for root, dirs, files in os.walk(source_dir):
            for file in files:
                if file.endswith('.py'):
                    # Arcname should be relative to source_dir
                    abs_path = os.path.join(root, file)
                    rel_path = os.path.relpath(abs_path, source_dir)
                    z.write(abs_path, rel_path)
    buf.seek(0)
    return buf.read()

def main():
    parser = argparse.ArgumentParser(description='Deploy Quest API Backend')
    parser.add_argument('--region', type=str, default='us-east-1', help='AWS Region')
    parser.add_argument('--env', type=str, default='-dev', help='Environment suffix (e.g., -dev)')
    args = parser.parse_args()

    region = args.region
    suffix = args.env # e.g. "-dev" or ""

    print(f"Deploying to {region} with suffix '{suffix}'")

    iam = boto3.client('iam', region_name=region)
    awslambda = boto3.client('lambda', region_name=region)
    apigateway = boto3.client('apigatewayv2', region_name=region)

    role_name = f"QuestLambdaRole{suffix}"
    role_arn = get_role_arn(iam, role_name)
    if not role_arn:
        role_arn = create_lambda_role(iam, role_name)

    function_name = f"quest-api{suffix}"

    # Zip Code
    print("Zipping backend code...")
    zip_content = create_zip('backend')

    # Environment Variables
    env_vars = {
        'DYNAMODB_TABLE_SESSIONS': f'quest-sessions{suffix}',
        'DYNAMODB_TABLE_TEAMS': f'quest-teams{suffix}'
        # AWS_DEFAULT_REGION is reserved and set automatically
    }

    try:
        print(f"Checking if function {function_name} exists...")
        awslambda.get_function(FunctionName=function_name)
        print("Updating function code...")
        awslambda.update_function_code(
            FunctionName=function_name,
            ZipFile=zip_content
        )
        print("Updating function config...")
        awslambda.update_function_configuration(
            FunctionName=function_name,
            Environment={'Variables': env_vars}
        )
    except awslambda.exceptions.ResourceNotFoundException:
        print(f"Creating function {function_name}...")
        awslambda.create_function(
            FunctionName=function_name,
            Runtime='python3.9',
            Role=role_arn,
            Handler='lambda_function.lambda_handler',
            Code={'ZipFile': zip_content},
            Environment={'Variables': env_vars},
            Timeout=15
        )

    # API Gateway
    api_name = f"quest-api-gateway{suffix}"
    print(f"Setting up API Gateway: {api_name}...")

    # Check if exists (Simple check by name)
    apis = apigateway.get_apis()['Items']
    api_id = next((api['ApiId'] for api in apis if api['Name'] == api_name), None)

    if not api_id:
        api = apigateway.create_api(
            Name=api_name,
            ProtocolType='HTTP',
            CorsConfiguration={
                'AllowOrigins': ['*'],
                'AllowMethods': ['GET', 'POST', 'OPTIONS'],
                'AllowHeaders': ['content-type']
            }
        )
        api_id = api['ApiId']
        print(f"Created API Gateway: {api_id}")
    else:
        print(f"Found existing API Gateway: {api_id}")

    # Integration
    # We need to find or create the integration
    # For simplicity, we create/update route.

    # 1. Integration
    integrations = apigateway.get_integrations(ApiId=api_id)['Items']
    integration_id = next((i['IntegrationId'] for i in integrations if 'quest-api' in i.get('IntegrationUri', '')), None)

    lambda_arn = awslambda.get_function(FunctionName=function_name)['Configuration']['FunctionArn']

    if not integration_id:
        print("Creating Integration...")
        integ = apigateway.create_integration(
            ApiId=api_id,
            IntegrationType='AWS_PROXY',
            IntegrationUri=lambda_arn,
            PayloadFormatVersion='2.0'
        )
        integration_id = integ['IntegrationId']

    # 2. Route
    # We use ANY /{proxy+} for catch-all
    routes = apigateway.get_routes(ApiId=api_id)['Items']
    route_key = "ANY /{proxy+}"
    route_exists = any(r['RouteKey'] == route_key for r in routes)

    if not route_exists:
        print("Creating Route...")
        apigateway.create_route(
            ApiId=api_id,
            RouteKey=route_key,
            Target=f"integrations/{integration_id}"
        )

    # 3. Stage
    stages = apigateway.get_stages(ApiId=api_id)['Items']
    default_stage = next((s for s in stages if s['StageName'] == '$default'), None)
    if not default_stage:
        print("Creating $default Stage (Auto-Deploy)...")
        apigateway.create_stage(
            ApiId=api_id,
            StageName='$default',
            AutoDeploy=True
        )

    # Permission
    # Allow API Gateway to invoke Lambda
    try:
        awslambda.add_permission(
            FunctionName=function_name,
            StatementId=f"apigateway-invoke-{api_id}",
            Action='lambda:InvokeFunction',
            Principal='apigateway.amazonaws.com',
            SourceArn=f"arn:aws:execute-api:{region}:{boto3.client('sts').get_caller_identity()['Account']}:{api_id}/*/*"
        )
        print("Added invocation permission.")
    except awslambda.exceptions.ResourceConflictException:
        print("Permission already exists.")

    endpoint = f"https://{api_id}.execute-api.{region}.amazonaws.com"
    print("\n---------------------------------------------------")
    print(f"DEPLOYMENT COMPLETE")
    print(f"API Endpoint: {endpoint}")
    print("---------------------------------------------------")

if __name__ == '__main__':
    main()
