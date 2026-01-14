import { google, Auth } from 'googleapis'

export interface GoogleOAuthConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
}

export interface GoogleTokens {
  access_token: string
  refresh_token?: string
  expiry_date: number
  token_type: string
  id_token?: string
  scope?: string
}

export interface GoogleUserInfo {
  id: string // Google user ID
  email: string
  verified_email: boolean
  name: string
  given_name: string
  family_name: string
  picture: string // Avatar URL
  locale: string
}

export class GoogleOAuthClient {
  private oauth2Client: Auth.OAuth2Client

  constructor(config: GoogleOAuthConfig) {
    this.oauth2Client = new google.auth.OAuth2(
      config.clientId,
      config.clientSecret,
      config.redirectUri
    )
  }

  /**
   * Generate Google OAuth URL with state parameter
   */
  generateAuthUrl(state: string): string {
    const scopes = [
      'openid',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ]

    const url = this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      state,
      prompt: 'consent', // Force consent screen to always get refresh token
    })

    return url
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCodeForTokens(code: string): Promise<GoogleTokens> {
    const { tokens } = await this.oauth2Client.getToken(code)

    return {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      access_token: tokens.access_token!,
      refresh_token: tokens.refresh_token || undefined,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      expiry_date: tokens.expiry_date!,
      token_type: tokens.token_type || 'Bearer',
      id_token: tokens.id_token || undefined,
      scope: tokens.scope || undefined,
    }
  }

  /**
   * Get user info from Google using access token
   */
  async getUserInfo(accessToken: string): Promise<GoogleUserInfo> {
    this.oauth2Client.setCredentials({ access_token: accessToken })

    const oauth2 = google.oauth2({
      auth: this.oauth2Client,
      version: 'v2',
    })

    const { data } = await oauth2.userinfo.get()

    return {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      id: data.id!,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      email: data.email!,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      verified_email: data.verified_email!,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      name: data.name!,
      given_name: data.given_name || '',
      family_name: data.family_name || '',
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      picture: data.picture!,
      locale: data.locale || 'en',
    }
  }
}
