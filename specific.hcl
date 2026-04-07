build "web" {
  base = "node"
  command = "npm run build"
}

service "web" {
  build = build.web
  command = "npm start"

  endpoint {
    public = true
  }

  env = {
    PORT                = port
    OPENAI_API_KEY      = secret.openai_api_key
    GOOGLE_CLIENT_ID    = secret.google_client_id
    GOOGLE_CLIENT_SECRET = secret.google_client_secret
    GOOGLE_REDIRECT_URI = "https://${service.web.public_url}/api/auth/callback"
    SESSION_SECRET      = secret.session_secret
    VOICEMAIL_SITE_URL  = "https://${service.web.public_url}"
  }

  dev {
    command = "npm run dev"

    env = {
      GOOGLE_REDIRECT_URI = "http://${service.web.public_url}/api/auth/callback"
      VOICEMAIL_SITE_URL  = "http://${service.web.public_url}"
    }
  }
}

secret "openai_api_key" {}

secret "google_client_id" {}

secret "google_client_secret" {}

secret "session_secret" {
  generated = true
}
