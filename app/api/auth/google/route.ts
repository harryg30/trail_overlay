import crypto from 'node:crypto'
import { getRequiredEnv } from '@/lib/env'

export async function GET(): Promise<Response> {
  let clientId: string
  let appUrl: string
  try {
    clientId = getRequiredEnv('GOOGLE_CLIENT_ID')
    appUrl = getRequiredEnv('NEXT_PUBLIC_APP_URL')
  } catch (err) {
    console.error('Google OAuth config error:', err)
    return new Response('Google auth is not configured', { status: 500 })
  }

  // Generate a random state parameter for CSRF protection
  const state = crypto.randomBytes(32).toString('hex')

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${appUrl}/api/auth/google/callback`,
    response_type: 'code',
    scope: 'openid profile email',
    access_type: 'offline',
    prompt: 'consent',
    state,
  })

  const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''

  const response = new Response(null, {
    status: 302,
    headers: {
      Location: googleAuthUrl,
      'Set-Cookie': `google_oauth_state=${state}; HttpOnly; Max-Age=600; SameSite=Lax; Path=/api/auth/google/callback${secure}`,
    },
  })

  return response
}
