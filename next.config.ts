import type { NextConfig } from 'next'
import { securityHeaders } from './core/security-headers'

const config: NextConfig = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders({
          isProd: process.env.NODE_ENV === 'production',
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
        }),
      },
    ]
  },
}

export default config
