import ngrok from "@ngrok/ngrok";
import { pipe } from "@screenpipe/js";

async function startNgrokTunnel(): Promise<void> {
  try {
    console.log("starting ngrok tunnel to screenpipe api");
    
    const listener = await ngrok.connect({
      addr: 3030,
      authtoken_from_env: true,
      domain_from_env: true,
    });

    const tunnelUrl = listener.url();
    console.log(`tunnel established: ${tunnelUrl}`);

    // retry inbox message a few times if screenpipe is still starting up
    for (let i = 0; i < 3; i++) {
      try {
        await pipe.inbox.send({
          title: "ngrok tunnel started",
          body: `screenpipe api is now accessible at: ${tunnelUrl}`,
        });
        break;
      } catch (err) {
        if (i === 2) {
          console.error("failed to send inbox message after retries:", err);
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    // Keep the process running
    process.on("SIGINT", async () => {
      console.log("shutting down ngrok tunnel");
      await listener.close();
      process.exit(0);
    });

  } catch (error) {
    console.error("error starting ngrok tunnel:", error);
    // don't try to send inbox message if we failed to start tunnel
  }
}

startNgrokTunnel();

/*

Instructions to run this pipe:

1. install screenpipe and git clone this repo
    ```
    git clone https://github.com/mediar-ai/screenpipe.git
    cd screenpipe
    ```

2. set up ngrok:
   - create an account at https://ngrok.com
   - get your authtoken from https://dashboard.ngrok.com/get-started/your-authtoken
   - set environment variables:
     ```
     export NGROK_AUTHTOKEN=your_authtoken
     # optional: set a custom domain if you have one
     export NGROK_DOMAIN=your-custom-domain
     ```

3. run the pipe:
   ```
   screenpipe pipe download ./examples/typescript/pipe-ngrok
   screenpipe pipe enable pipe-ngrok
   screenpipe
   ```

*/
