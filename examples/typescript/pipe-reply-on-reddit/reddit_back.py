import os
import asyncio
import base64
import json
import webbrowser
from aiohttp import web
import aiohttp
from praw import Reddit
import praw
from concurrent.futures import ThreadPoolExecutor
from praw.models import Submission
import urllib.parse

CLIENT_ID = 'vfJAK6poiF0yHaSrywrpCg'
CLIENT_SECRET = 'lJZ6TxI_YyValRBBuzHaUlFGNx8qxw'
REDIRECT_URI = 'http://localhost:8080'
USER_AGENT = 'python:com.example.myredditapp:v1.0.0 (by /u/Matthew_heartful)'

reddit = None

executor = ThreadPoolExecutor(max_workers=5)

TOKEN_FILE = 'reddit_token.txt'

async def get_reddit_token():
    if os.path.exists(TOKEN_FILE):
        with open(TOKEN_FILE, 'r') as f:
            return f.read().strip()

    scopes = [
        'identity', 'edit', 'flair', 'history', 'modconfig', 'modflair',
        'modlog', 'modposts', 'modwiki', 'mysubreddits', 'privatemessages',
        'read', 'report', 'save', 'submit', 'subscribe', 'vote', 'wikiedit', 'wikiread'
    ]
    scope_string = ' '.join(scopes)

    authorization_url = f'https://www.reddit.com/api/v1/authorize?client_id={CLIENT_ID}&response_type=code&state=randomstring&redirect_uri={REDIRECT_URI}&duration=permanent&scope={scope_string}'

    async def handle_callback(request):
        code = request.query.get('code')
        if code:
            try:
                async with aiohttp.ClientSession() as session:
                    auth = base64.b64encode(f'{CLIENT_ID}:{CLIENT_SECRET}'.encode()).decode()
                    headers = {
                        'Authorization': f'Basic {auth}',
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                    data = f'grant_type=authorization_code&code={code}&redirect_uri={REDIRECT_URI}'
                    async with session.post('https://www.reddit.com/api/v1/access_token', headers=headers, data=data) as response:
                        token_data = await response.json()
                
                reddit_token = token_data.get('refresh_token')
                if reddit_token:
                    # Store the token in a file
                    with open(TOKEN_FILE, 'w') as f:
                        f.write(reddit_token)
                    
                    request.app['reddit_token'] = reddit_token
                    request.app['got_token'].set()
                
                return web.Response(text='authorization successful! you can close this window now.')
            except Exception as e:
                print(f'error: {e}')
                return web.Response(status=500, text='error during authorization')
        else:
            return web.Response(status=400, text='authorization code not found')

    app = web.Application()
    app.router.add_get('/', handle_callback)
    app['got_token'] = asyncio.Event()

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, 'localhost', 8080)
    await site.start()

    print('please authorize the application in your browser.')
    webbrowser.open(authorization_url)

    # Wait for the token to be received
    await app['got_token'].wait()
    
    # Clean up
    await runner.cleanup()

    return app['reddit_token']

async def track_reddit_comments(username, limit=10):
    try:
        def fetch_comments():
            user = reddit.redditor(username)
            comments = list(user.comments.new(limit=limit))
            return [
                {
                    'body': comment.body,
                    'subreddit': comment.subreddit.display_name,
                    'created': comment.created_utc
                }
                for comment in comments
            ]
        
        return await asyncio.get_event_loop().run_in_executor(executor, fetch_comments)
    except Exception as e:
        print(f'error fetching reddit comments: {e}')
        raise

async def upvote_comment(comment_id):
    try:
        def do_upvote():
            comment = reddit.comment(comment_id)
            comment.upvote()
            return True
        
        return await asyncio.get_event_loop().run_in_executor(executor, do_upvote)
    except Exception as e:
        print(f'error upvoting comment: {e}')
        return False

async def reply_to_comment(comment_id, reply_text):
    try:
        def do_reply():
            comment = reddit.comment(comment_id)
            new_comment = comment.reply(reply_text)
            print(f"Debug: New reply created with ID: {new_comment.id}")
            return new_comment.id
        
        result = await asyncio.get_event_loop().run_in_executor(executor, do_reply)
        print(f"Debug: Returning reply ID: {result}")
        return result
    except praw.exceptions.RedditAPIException as e:
        print(f"API exception when replying to comment: {e}")
        for subexception in e.items:
            print(f"Error type: {subexception.error_type}")
            print(f"Error message: {subexception.message}")
    except Exception as e:
        print(f'error replying to comment: {e}')
    return None

async def upvote_item(item):
    try:
        def do_upvote():
            item.upvote()
            return True
        
        return await asyncio.get_event_loop().run_in_executor(executor, do_upvote)
    except Exception as e:
        print(f'error upvoting item: {e}')
        return False

async def get_followed_users():
    try:
        def fetch_followed():
            followed = []
            for item in reddit.user.subreddits(limit=None):
                print(f"debug: found subreddit {item.display_name}, type: {item.subreddit_type}")
                if item.subreddit_type == 'user':
                    followed.append(item)
            print(f"debug: found {len(followed)} followed users")
            return followed
        
        return await asyncio.get_event_loop().run_in_executor(executor, fetch_followed)
    except Exception as e:
        print(f'error fetching followed users: {e}')
        print(f'error type: {type(e).__name__}')
        print(f'error details: {str(e)}')
        raise

async def upvote_user_content(username, limit=10):
    try:
        def fetch_and_upvote():
            user = reddit.redditor(username)
            comments = list(user.comments.new(limit=limit))
            posts = list(user.submissions.new(limit=limit))
            return comments, posts
        
        comments, posts = await asyncio.get_event_loop().run_in_executor(executor, fetch_and_upvote)
        
        for comment in comments:
            upvoted = await upvote_item(comment)
            print(f"upvoted comment by {username} in r/{comment.subreddit.display_name}: {'success' if upvoted else 'failed'}")
        
        for post in posts:
            upvoted = await upvote_item(post)
            print(f"upvoted post by {username} in r/{post.subreddit.display_name}: {'success' if upvoted else 'failed'}")
        
        return True
    except Exception as e:
        print(f'error upvoting content for {username}: {e}')
        return False

async def upvote_followed_users_content():
    try:
        followed_users = await get_followed_users()
        if not followed_users:
            print("you are not following any users.")
            return
        
        print("users you follow:")
        for user in followed_users:
            username = user.display_name.split('_', 1)[1]  # Remove 'u_' prefix
            print(f"- {username}")
            await upvote_user_content(username)
            print()  # add a blank line for readability
    except Exception as e:
        print(f"error in upvote_followed_users_content: {e}")

async def delete_item(item_id):
    try:
        def do_delete():
            try:
                item = reddit.comment(item_id)
                print(f"Found comment: {item.id}")
                print(f"Comment author: {item.author}")
                print(f"Comment body: {item.body}")
                print(f"Current user: {reddit.user.me().name}")
                
                if item.author == reddit.user.me():
                    item.delete()
                    print("Delete operation completed")
                    return True
                else:
                    print("Cannot delete: current user is not the author of the comment")
                    return False
            except praw.exceptions.PRAWException as e:
                print(f"PRAW exception: {e}")
                return False
        
        return await asyncio.get_event_loop().run_in_executor(executor, do_delete)
    except Exception as e:
        print(f'Error deleting item: {e}')
        return False

async def handle_delete(request):
    try:
        data = await request.json()
        item_id = data.get('item_id')

        if not item_id:
            return web.json_response({'error': 'missing item_id'}, status=400)

        delete_result = await delete_item(item_id)
        if delete_result:
            return web.json_response({'success': True})
        else:
            return web.json_response({'success': False, 'error': 'failed to delete item'}, status=500)
    except Exception as e:
        return web.json_response({'error': str(e)}, status=500)

async def handle_post_reply(request):
    comment_id = request.query.get('comment_id')
    reply_text = request.query.get('reply_text')
    
    if not comment_id or not reply_text:
        return web.Response(text='Missing comment_id or reply_text', status=400)
    
    reply_text = urllib.parse.unquote(reply_text)
    
    reply_result = await reply_to_comment(comment_id, reply_text)
    if reply_result:
        return web.Response(text=f'Reply posted successfully. New reply ID: {reply_result}')
    else:
        return web.Response(text='Failed to post reply', status=500)

async def start_server():
    app = web.Application()
    app.router.add_get('/post_reply', handle_post_reply)
    app.router.add_post('/delete', handle_delete)  # Add the new endpoint
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, 'localhost', 8080)
    await site.start()
    print("server started at http://localhost:8080")
    return runner

async def main():
    global reddit
    try:
        reddit_token = await get_reddit_token()
        print('reddit token obtained successfully')

        reddit = Reddit(
            client_id=CLIENT_ID,
            client_secret=CLIENT_SECRET,
            refresh_token=reddit_token,
            user_agent=USER_AGENT
        )

        # start the server
        runner = await start_server()

        # keep the server running
        while True:
            await asyncio.sleep(3600)  # sleep for an hour

    except Exception as e:
        print(f'error: {e}')
    finally:
        if 'runner' in locals():
            await runner.cleanup()

if __name__ == '__main__':
    asyncio.run(main())