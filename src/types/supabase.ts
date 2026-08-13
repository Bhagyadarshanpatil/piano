export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          username: string | null
          full_name: string | null
          age: number | null
          fav_genres: string[] | null
          experience_level: string | null
          onboarding_complete: boolean | null
          created_at: string | null
        }
        Insert: {
          id: string
          username?: string | null
          full_name?: string | null
          age?: number | null
          fav_genres?: string[] | null
          experience_level?: string | null
          onboarding_complete?: boolean | null
          created_at?: string | null
        }
        Update: {
          id?: string
          username?: string | null
          full_name?: string | null
          age?: number | null
          fav_genres?: string[] | null
          experience_level?: string | null
          onboarding_complete?: boolean | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_id_fkey"
            columns: ["id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      recently_played: {
        Row: {
          id: string
          user_id: string
          song_id: string
          played_at: string
        }
        Insert: {
          id?: string
          user_id: string
          song_id: string
          played_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          song_id?: string
          played_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recently_played_song_id_fkey"
            columns: ["song_id"]
            referencedRelation: "tracks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recently_played_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      tracks: {
        Row: {
          id: string
          title: string
          artist: string
          genre: string | null
          difficulty_level: string | null
          file_url: string
          created_at: string
        }
        Insert: {
          id?: string
          title: string
          artist: string
          genre?: string | null
          difficulty_level?: string | null
          file_url: string
          created_at?: string
        }
        Update: {
          id?: string
          title?: string
          artist?: string
          genre?: string | null
          difficulty_level?: string | null
          file_url?: string
          created_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
