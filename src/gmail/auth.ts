import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import fs from 'fs-extra';
import path from 'path';
import readline from 'readline';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send'
];
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');

export async function authorize(): Promise<OAuth2Client> {
  let credentials;
  try {
    credentials = await fs.readJson(CREDENTIALS_PATH);
  } catch (err) {
    throw new Error(`Error loading client secret file at ${CREDENTIALS_PATH}. Please create one from Google Cloud Console.`);
  }

  const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  try {
    const token = await fs.readJson(TOKEN_PATH);
    oAuth2Client.setCredentials(token);
    return oAuth2Client;
  } catch (err) {
    return getNewToken(oAuth2Client);
  }
}

async function getNewToken(oAuth2Client: OAuth2Client): Promise<OAuth2Client> {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });
  console.log('Authorize this app by visiting this url:', authUrl);
  console.log('\nNOTE: If you are redirected to "This site can\'t be reached" (localhost),');
  console.log('copy the "code" parameter from the URL in your browser address bar.');
  console.log('Example: http://localhost/?code=4/0Acv...&scope=... -> Copy "4/0Acv..."\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve, reject) => {
    rl.question('Enter the code from that page here: ', async (input) => {
      rl.close();
      try {
        // Handle if user pastes full URL
        let code = input.trim();
        if (code.includes('code=')) {
            const match = code.match(/code=([^&]*)/);
            if (match) {
                code = decodeURIComponent(match[1]);
            }
        }

        const { tokens } = await oAuth2Client.getToken(code);
        oAuth2Client.setCredentials(tokens);
        await fs.writeJson(TOKEN_PATH, tokens);
        console.log('Token stored to', TOKEN_PATH);
        resolve(oAuth2Client);
      } catch (err) {
        reject(err);
      }
    });
  });
}

