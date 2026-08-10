export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      attendances: {
        Row: {
          entry_id: string
          entry_kind: string
          id: string
          matchday_id: string
          season_id: string
          status: string
        }
        Insert: {
          entry_id: string
          entry_kind?: string
          id?: string
          matchday_id: string
          season_id: string
          status: string
        }
        Update: {
          entry_id?: string
          entry_kind?: string
          id?: string
          matchday_id?: string
          season_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendances_entry_id_entry_kind_fkey"
            columns: ["entry_id", "entry_kind"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id", "kind"]
          },
          {
            foreignKeyName: "attendances_entry_id_season_id_fkey"
            columns: ["entry_id", "season_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id", "season_id"]
          },
          {
            foreignKeyName: "attendances_matchday_id_season_id_fkey"
            columns: ["matchday_id", "season_id"]
            isOneToOne: false
            referencedRelation: "matchdays"
            referencedColumns: ["id", "season_id"]
          },
        ]
      }
      awards: {
        Row: {
          entry_id: string
          id: string
          matchday_id: string
          points: number
          position: number
          season_id: string
        }
        Insert: {
          entry_id: string
          id?: string
          matchday_id: string
          points: number
          position: number
          season_id: string
        }
        Update: {
          entry_id?: string
          id?: string
          matchday_id?: string
          points?: number
          position?: number
          season_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "awards_entry_id_season_id_fkey"
            columns: ["entry_id", "season_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id", "season_id"]
          },
          {
            foreignKeyName: "awards_matchday_id_season_id_fkey"
            columns: ["matchday_id", "season_id"]
            isOneToOne: false
            referencedRelation: "matchdays"
            referencedColumns: ["id", "season_id"]
          },
        ]
      }
      entries: {
        Row: {
          created_at: string
          display_name: string
          id: string
          kind: string
          matchday_id: string | null
          player_id: string | null
          season_id: string
          seed_position: number
        }
        Insert: {
          created_at?: string
          display_name?: string
          id?: string
          kind: string
          matchday_id?: string | null
          player_id?: string | null
          season_id: string
          seed_position: number
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          kind?: string
          matchday_id?: string | null
          player_id?: string | null
          season_id?: string
          seed_position?: number
        }
        Relationships: [
          {
            foreignKeyName: "entries_guest_matchday"
            columns: ["matchday_id", "season_id"]
            isOneToOne: false
            referencedRelation: "matchdays"
            referencedColumns: ["id", "season_id"]
          },
          {
            foreignKeyName: "entries_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entries_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      match_sets: {
        Row: {
          games_a: number
          games_b: number
          id: string
          match_id: string
          set_number: number
        }
        Insert: {
          games_a: number
          games_b: number
          id?: string
          match_id: string
          set_number: number
        }
        Update: {
          games_a?: number
          games_b?: number
          id?: string
          match_id?: string
          set_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "match_sets_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      matchdays: {
        Row: {
          closed_at: string | null
          id: string
          kind: string
          number: number
          played_on: string | null
          season_id: string
          status: string
        }
        Insert: {
          closed_at?: string | null
          id?: string
          kind?: string
          number: number
          played_on?: string | null
          season_id: string
          status?: string
        }
        Update: {
          closed_at?: string | null
          id?: string
          kind?: string
          number?: number
          played_on?: string | null
          season_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "matchdays_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      matches: {
        Row: {
          id: string
          matchday_id: string
          pair_a: string
          pair_b: string
          round: number
        }
        Insert: {
          id?: string
          matchday_id: string
          pair_a: string
          pair_b: string
          round: number
        }
        Update: {
          id?: string
          matchday_id?: string
          pair_a?: string
          pair_b?: string
          round?: number
        }
        Relationships: [
          {
            foreignKeyName: "matches_matchday_id_fkey"
            columns: ["matchday_id"]
            isOneToOne: false
            referencedRelation: "matchdays"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_pair_a_matchday_id_fkey"
            columns: ["pair_a", "matchday_id"]
            isOneToOne: false
            referencedRelation: "pairs"
            referencedColumns: ["id", "matchday_id"]
          },
          {
            foreignKeyName: "matches_pair_b_matchday_id_fkey"
            columns: ["pair_b", "matchday_id"]
            isOneToOne: false
            referencedRelation: "pairs"
            referencedColumns: ["id", "matchday_id"]
          },
        ]
      }
      pair_locks: {
        Row: {
          entry_a: string
          entry_b: string
          id: string
          matchday_id: string
          season_id: string
        }
        Insert: {
          entry_a: string
          entry_b: string
          id?: string
          matchday_id: string
          season_id: string
        }
        Update: {
          entry_a?: string
          entry_b?: string
          id?: string
          matchday_id?: string
          season_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pair_locks_entry_a_season_id_fkey"
            columns: ["entry_a", "season_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id", "season_id"]
          },
          {
            foreignKeyName: "pair_locks_entry_b_season_id_fkey"
            columns: ["entry_b", "season_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id", "season_id"]
          },
          {
            foreignKeyName: "pair_locks_matchday_id_season_id_fkey"
            columns: ["matchday_id", "season_id"]
            isOneToOne: false
            referencedRelation: "matchdays"
            referencedColumns: ["id", "season_id"]
          },
        ]
      }
      pairs: {
        Row: {
          entry_a: string
          entry_b: string
          id: string
          matchday_id: string
          season_id: string
        }
        Insert: {
          entry_a: string
          entry_b: string
          id?: string
          matchday_id: string
          season_id: string
        }
        Update: {
          entry_a?: string
          entry_b?: string
          id?: string
          matchday_id?: string
          season_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pairs_entry_a_season_id_fkey"
            columns: ["entry_a", "season_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id", "season_id"]
          },
          {
            foreignKeyName: "pairs_entry_b_season_id_fkey"
            columns: ["entry_b", "season_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id", "season_id"]
          },
          {
            foreignKeyName: "pairs_matchday_id_season_id_fkey"
            columns: ["matchday_id", "season_id"]
            isOneToOne: false
            referencedRelation: "matchdays"
            referencedColumns: ["id", "season_id"]
          },
        ]
      }
      players: {
        Row: {
          created_at: string
          display_name: string
          id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          display_name: string
          id?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      seasons: {
        Row: {
          config: Json
          created_at: string
          created_by: string
          id: string
          invite_token: string
          name: string
          rules_text: string
          rules_updated_at: string | null
          status: string
        }
        Insert: {
          config: Json
          created_at?: string
          created_by: string
          id?: string
          invite_token?: string
          name: string
          rules_text?: string
          rules_updated_at?: string | null
          status?: string
        }
        Update: {
          config?: Json
          created_at?: string
          created_by?: string
          id?: string
          invite_token?: string
          name?: string
          rules_text?: string
          rules_updated_at?: string | null
          status?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_seat: {
        Args: { p_entry: string; p_token: string }
        Returns: string
      }
      close_matchday: {
        Args: { p_awards: Json; p_matchday: string }
        Returns: undefined
      }
      is_participant: { Args: { p_season: string }; Returns: boolean }
      is_season_admin: { Args: { p_season: string }; Returns: boolean }
      match_is_open: { Args: { p_match: string }; Returns: boolean }
      match_season: { Args: { p_match: string }; Returns: string }
      matchday_season: { Args: { p_matchday: string }; Returns: string }
      open_matchday: { Args: { p_matchday: string }; Returns: undefined }
      season_invite: {
        Args: { p_token: string }
        Returns: {
          admin_name: string
          claimed: boolean
          display_name: string
          entry_id: string
          season_id: string
          season_name: string
          seed_position: number
          squad_size: number
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

