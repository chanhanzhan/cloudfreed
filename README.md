<div style="text-align:center;">
  <img src="html/CloudFreed.png" alt="CloudFreed Logo" width="48" style="float:left; margin-right:10px;">
  <h1>CloudFreed V4</h1>
</div>

CloudFreed is a powerful tool designed to bypass Cloudflare anti-bot protection, allowing users to access websites without being restricted by captchas or Cloudflare's security measures.

## Installation

Before using CloudFreed, ensure that you have Node.js installed on your system. If not, you can download and install it from [Node.js website](https://nodejs.org/).

Once Node.js is installed, follow these steps to set up CloudFreed:

1. Clone or download the CloudFreed repository to your local machine, you can get the latest download [here](https://github.com/Akmal-CloudFreed/CloudFreed-CloudFlare-bypass/archive/refs/heads/main.zip).
2. Extract the file.
3. Open a terminal and navigate to the directory where you have cloned/downloaded CloudFreed.
4. Run the following command to install dependencies:

   ```
   npm i
   ```

   alternatively, you can use:

   ```
   npm install
   ```

## Usage

CloudFreed can be used either through command line examples or via its API interface.

### Command Line Usage

After installing dependencies, you can run the example scripts:

```bash
node example.js cf-challenge
```

Available examples:

- cf-challenge
- cf-challenge-iuam (I am under attack mode)
- turnstile
- cloudflare-invisible
- recaptcha-invisible

### API Usage

You can also run CloudFreed as an API server:

1. Start the API server:

```bash
node api.js -k YOUR_CLIENT_KEY
```

Available options:
- `-k, --clientKey`: Client API key (required)
- `-m, --maxTasks`: Maximum concurrent tasks (default: 1)
- `-p, --port`: Server port to listen (default: 3000)
- `-h, --host`: Server host to listen (default: localhost)
- `-t, --timeout`: Timeout per task in seconds (default: 60)

2. Create a new task:

```
POST http://localhost:3000/createTask

{
  "clientKey": "YOUR_CLIENT_KEY",
  "type": "CloudflareChallenge",
  "url": "www.example.com",
  "userAgent": "YOUR_USER_AGENT",
  "proxy": {
    "scheme": "socks5",
    "host": "127.0.0.1",
    "port": 1080
  }
}
```

Response Example:

```
{
    "taskId": "m7dobozwh6gucqy29dk"
}
```

3. Get task results:

```
POST http://localhost:3000/getTaskResult

{
  "clientKey": "YOUR_CLIENT_KEY",
  "taskId": "YOUR_TASK_ID"
}
```

Response Example:

```
{
  "status": "completed",
  "result": {
    "success": true,
    "code": 200,
    "response": "<cf_clearance_or_token>",
    "data": {
      "type": "CloudflareChallenge",
      "url": "www.example.com",
      "timeout": 60,
      "userAgent": "YOUR_USER_AGENT"
    }
  }
}
```

## Note

CloudFreed is intended for educational and research purposes only. Please use it responsibly and respect the terms of service of the websites you visit.
