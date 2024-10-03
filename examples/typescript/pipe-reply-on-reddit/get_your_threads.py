import requests
import urllib.parse
import json

def get_user_posts(username, limit=25):
    url = f"https://www.reddit.com/user/{username}/submitted.json"
    headers = {"User-Agent": "MyBot/1.0"}
    params = {"limit": limit}
    
    response = requests.get(url, headers=headers, params=params)
    
    if response.status_code == 200:
        data = response.json()
        posts = data['data']['children']
        return [post['data'] for post in posts]
    else:
        return f"Error: {response.status_code}"

def get_post_comments(post):
    subreddit = post['subreddit']
    post_id = post['id']
    url = f"https://www.reddit.com/r/{subreddit}/comments/{post_id}.json"
    headers = {"User-Agent": "MyBot/1.0"}
    
    response = requests.get(url, headers=headers)
    
    if response.status_code == 200:
        data = response.json()
        comments = data[1]['data']['children']
        return [comment['data'] for comment in comments if comment['kind'] == 't1']
    else:
        return []

def print_comment_thread(comments, post_id, subreddit, indent=0):
    for comment in comments:
        if isinstance(comment, dict) and 'kind' in comment and comment['kind'] == 't1':
            comment = comment['data']
        if isinstance(comment, dict) and 'author' in comment:
            prefix = '    ' * indent
            body_lines = comment['body'].split('\n')
            formatted_body = '\n'.join([prefix + line.strip() for line in body_lines if line.strip()])
            print(f"{prefix}({comment['id']}) {formatted_body} ({comment['author']}) [{comment['score']}]")
            
            comment_id = comment['id']
            reply_text = "<<<assistant reply here>>>"
            encoded_reply = urllib.parse.quote(reply_text)
            link = f"http://localhost:8080/post_reply?comment_id={comment_id}&reply_text={encoded_reply}"
            
            print(f"{prefix}Reply: {reply_text} [SEND]")
            print()
            
            if 'replies' in comment and comment['replies']:
                if isinstance(comment['replies'], dict) and 'data' in comment['replies']:
                    print_comment_thread(comment['replies']['data']['children'], post_id, subreddit, indent + 1)
                elif isinstance(comment['replies'], list):
                    print_comment_thread(comment['replies'], post_id, subreddit, indent + 1)

# Example usage
username = "Matthew_heartful"  # Replace with the username you're interested in
posts = get_user_posts(username, limit=5)
for post in posts:
    print(f"r/{post['subreddit']}")
    print(f"{post['title']} [score:{post['score']}]")
    print("\nComments:")
    comments = get_post_comments(post)
    if print_comment_thread(comments, post['id'], post['subreddit']):
        break  # Stop after replying to one comment
    print("---\n")

# Function to get a specific post and its comments
def get_specific_post(post_id):
    url = f"https://www.reddit.com/comments/{post_id}.json"
    headers = {"User-Agent": "MyBot/1.0"}
    
    response = requests.get(url, headers=headers)
    
    if response.status_code == 200:
        data = response.json()
        post = data[0]['data']['children'][0]['data']
        comments = data[1]['data']['children']
        return post, comments
    else:
        return None, None

# Get and print the specific thread
post_id = "1fqf0ye"
post, comments = get_specific_post(post_id)

if post and comments:
    print(f"r/{post['subreddit']}")
    print(f"{post['title']} [{post['score']}]")
    print(f"\n{post['selftext']}\n")
    print("comments:")
    print_comment_thread(comments, post['id'], post['subreddit'])
else:
    print("failed to retrieve the post or comments.")