# Cabinet Material Calculator

This app is set up as a Node.js + Express calculator that can be hosted on Render.com from GitHub.

## Deploy to Render

1. Push this project to GitHub.
2. In Render, create a new Web Service and connect the repository.
3. Render should detect the Node app automatically.
4. Use the following start command if Render does not pick it up automatically:
   - `npm start`
5. Add environment variables in Render:
   - `WIX_UPGRADE_URL` (set to your Wix checkout or membership URL)
   - `WIX_ACCESS_TOKEN` (optional, for verifying paid access tokens from Wix)

## Free vs pro flow

- Free users get the core calculator experience.
- Pro users can be routed to a Wix checkout or a Wix member-area page through the upgrade link.
- The backend exposes `/api/config` and `/api/plan` so the front end can display the current access state.

## Local development

```bash
npm install
npm start
```
