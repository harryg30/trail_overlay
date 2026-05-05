import { getRequiredEnv } from '@/lib/env'

export async function GET(): Promise<Response> {
  let clientId: string
  let appUrl: string
  try {
    clientId = getRequiredEnv('STRAVA_CLIENT_ID')
    appUrl = getRequiredEnv('NEXT_PUBLIC_APP_URL')
  } catch (err) {
    console.error('Strava OAuth config error:', err)
    return new Response('Strava auth is not configured', { status: 500 })
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${appUrl}/api/auth/strava/callback`,
    response_type: "code",
    scope: "read,activity:read_all",
    approval_prompt: "force"
  });
  return Response.redirect(
    `https://www.strava.com/oauth/authorize?${params.toString()}`
  );
}
