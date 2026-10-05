import { request } from './client'

export interface UserProfile {
  id: number
  username: string
  email: string
  created_at: string
}

export interface LoginResponse {
  access_token: string
  token_type: string
  expires_at: string
  user: UserProfile
}

export function login(email: string, password: string) {
  return request<LoginResponse>('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

export function register(username: string, email: string, password: string) {
  return request<UserProfile>('/api/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, email, password }),
  })
}
