import boto3
import time

def create_table(dynamodb, table_name, key_schema, attribute_definitions, region):
    try:
        table = dynamodb.create_table(
            TableName=table_name,
            KeySchema=key_schema,
            AttributeDefinitions=attribute_definitions,
            BillingMode='PAY_PER_REQUEST'
        )
        print(f"Creating table {table_name}...")
        table.wait_until_exists()
        print(f"Table {table_name} created successfully.")
        
        # Wait a bit to ensure table is active for TTL
        time.sleep(5)

        # Enable TTL
        if 'sessions' in table_name or 'teams' in table_name:
             print(f"Enabling TTL for {table_name}...")
             dynamodb_client = boto3.client('dynamodb', region_name=region) # Need client for update_time_to_live
             dynamodb_client.update_time_to_live(
                 TableName=table_name,
                 TimeToLiveSpecification={
                     'Enabled': True,
                     'AttributeName': 'expiresAt'
                 }
             )
             print("TTL enabled.")
    except Exception as e:
        if "ResourceInUseException" in str(e):
            print(f"Table {table_name} already exists.")
             # Try enabling TTL even if table exists
            try:
                if 'sessions' in table_name or 'teams' in table_name:
                    dynamodb_client = boto3.client('dynamodb', region_name=region)
                    dynamodb_client.update_time_to_live(
                        TableName=table_name,
                        TimeToLiveSpecification={'Enabled': True, 'AttributeName': 'expiresAt'}
                    )
                    print(f"TTL verified/enabled for existing table {table_name}")
            except Exception as ttl_e:
                print(f"TTL check failed: {ttl_e}")

        else:
            print(f"Error creating {table_name}: {e}")

import argparse

def main():
    parser = argparse.ArgumentParser(description='Setup DynamoDB tables for Quest API')
    parser.add_argument('--region', type=str, default='us-east-1', help='AWS Region (default: us-east-1)')
    parser.add_argument('--env', type=str, default='', help='Environment suffix (e.g., -dev). Default is empty (prod).')
    args = parser.parse_args()

    region = args.region
    suffix = args.env
    
    print(f"Connecting to DynamoDB in region: {region}")
    dynamodb = boto3.resource('dynamodb', region_name=region)

    sessions_table = f'quest-sessions{suffix}'
    teams_table = f'quest-teams{suffix}'

    print(f"Provisioning tables: {sessions_table}, {teams_table}")

    # Session Table
    # PK: sessionId (String)
    create_table(
        dynamodb,
        sessions_table,
        [{'AttributeName': 'sessionId', 'KeyType': 'HASH'}],
        [{'AttributeName': 'sessionId', 'AttributeType': 'S'}],
        region
    )

    # Team Table
    # PK: teamCode (String)
    create_table(
        dynamodb,
        teams_table,
        [{'AttributeName': 'teamCode', 'KeyType': 'HASH'}],
        [{'AttributeName': 'teamCode', 'AttributeType': 'S'}],
        region
    )

if __name__ == '__main__':
    main()
