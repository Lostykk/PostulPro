export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
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
      affiliate_clicks: {
        Row: {
          affiliate_code: string
          created_at: string
          id: string
        }
        Insert: {
          affiliate_code: string
          created_at?: string
          id?: string
        }
        Update: {
          affiliate_code?: string
          created_at?: string
          id?: string
        }
        Relationships: []
      }
      affiliate_referrals: {
        Row: {
          commission_amount: number | null
          commission_rate: number | null
          created_at: string
          id: string
          referred_user_id: string
          referrer_id: string
          status: string
        }
        Insert: {
          commission_amount?: number | null
          commission_rate?: number | null
          created_at?: string
          id?: string
          referred_user_id: string
          referrer_id: string
          status?: string
        }
        Update: {
          commission_amount?: number | null
          commission_rate?: number | null
          created_at?: string
          id?: string
          referred_user_id?: string
          referrer_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_referrals_referred_user_id_fkey"
            columns: ["referred_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_referrals_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_project_steps: {
        Row: {
          attempts: number
          completed_at: string | null
          created_at: string
          credits_cost: number
          credits_reserved: boolean
          description: string | null
          error_code: string | null
          error_message_safe: string | null
          id: string
          idempotency_key: string
          input_json: Json
          output_generation_id: string | null
          position: number
          project_id: string
          started_at: string | null
          status: string
          title: string
          tool_key: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          credits_cost?: number
          credits_reserved?: boolean
          description?: string | null
          error_code?: string | null
          error_message_safe?: string | null
          id?: string
          idempotency_key: string
          input_json?: Json
          output_generation_id?: string | null
          position: number
          project_id: string
          started_at?: string | null
          status?: string
          title: string
          tool_key: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          credits_cost?: number
          credits_reserved?: boolean
          description?: string | null
          error_code?: string | null
          error_message_safe?: string | null
          id?: string
          idempotency_key?: string
          input_json?: Json
          output_generation_id?: string | null
          position?: number
          project_id?: string
          started_at?: string | null
          status?: string
          title?: string
          tool_key?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_project_steps_output_generation_id_fkey"
            columns: ["output_generation_id"]
            isOneToOne: false
            referencedRelation: "generations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_project_steps_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "ai_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_project_steps_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_projects: {
        Row: {
          archived_at: string | null
          assumptions_json: Json | null
          brief_json: Json | null
          completed_at: string | null
          created_at: string
          current_step_id: string | null
          estimated_credits: number
          execution_mode: string
          id: string
          language: string
          last_error_code: string | null
          objective: string | null
          original_idea: string
          plan_json: Json | null
          plan_stale: boolean
          progress_percent: number
          project_type: string | null
          spent_credits: number
          status: string
          target_audience: string | null
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          assumptions_json?: Json | null
          brief_json?: Json | null
          completed_at?: string | null
          created_at?: string
          current_step_id?: string | null
          estimated_credits?: number
          execution_mode?: string
          id?: string
          language?: string
          last_error_code?: string | null
          objective?: string | null
          original_idea: string
          plan_json?: Json | null
          plan_stale?: boolean
          progress_percent?: number
          project_type?: string | null
          spent_credits?: number
          status?: string
          target_audience?: string | null
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          archived_at?: string | null
          assumptions_json?: Json | null
          brief_json?: Json | null
          completed_at?: string | null
          created_at?: string
          current_step_id?: string | null
          estimated_credits?: number
          execution_mode?: string
          id?: string
          language?: string
          last_error_code?: string | null
          objective?: string | null
          original_idea?: string
          plan_json?: Json | null
          plan_stale?: boolean
          progress_percent?: number
          project_type?: string | null
          spent_credits?: number
          status?: string
          target_audience?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_projects_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          created_at: string
          id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          revoked_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          revoked_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          revoked_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_history: {
        Row: {
          created_at: string
          event_type: string
          id: string
          reason: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          reason?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          reason?: string | null
          user_id?: string
        }
        Relationships: []
      }
      billing_rpc_config: {
        Row: {
          id: boolean
          secret_hash: string
          updated_at: string
        }
        Insert: {
          id?: boolean
          secret_hash: string
          updated_at?: string
        }
        Update: {
          id?: boolean
          secret_hash?: string
          updated_at?: string
        }
        Relationships: []
      }
      consultant_conversations: {
        Row: {
          created_at: string
          id: string
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "consultant_conversations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      consultant_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          role: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          role: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "consultant_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "consultant_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      folders: {
        Row: {
          color: string | null
          created_at: string
          id: string
          name: string | null
          parent_id: string | null
          user_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          name?: string | null
          parent_id?: string | null
          user_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          name?: string | null
          parent_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "folders_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "folders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      generations: {
        Row: {
          artifact_type: string | null
          created_at: string
          folder_id: string | null
          id: string
          is_favorite: boolean
          output: string | null
          project_id: string | null
          project_step_id: string | null
          prompt_json: Json | null
          title: string | null
          tokens_used: number | null
          tool: string
          user_id: string
        }
        Insert: {
          artifact_type?: string | null
          created_at?: string
          folder_id?: string | null
          id?: string
          is_favorite?: boolean
          output?: string | null
          project_id?: string | null
          project_step_id?: string | null
          prompt_json?: Json | null
          title?: string | null
          tokens_used?: number | null
          tool: string
          user_id: string
        }
        Update: {
          artifact_type?: string | null
          created_at?: string
          folder_id?: string | null
          id?: string
          is_favorite?: boolean
          output?: string | null
          project_id?: string | null
          project_step_id?: string | null
          prompt_json?: Json | null
          title?: string | null
          tokens_used?: number | null
          tool?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "generations_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "ai_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generations_project_step_id_fkey"
            columns: ["project_step_id"]
            isOneToOne: false
            referencedRelation: "ai_project_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      lemon_squeezy_events: {
        Row: {
          event_name: string
          id: string
          processed_at: string
        }
        Insert: {
          event_name: string
          id: string
          processed_at?: string
        }
        Update: {
          event_name?: string
          id?: string
          processed_at?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          category: string | null
          created_at: string
          description: string | null
          file_url: string | null
          id: string
          is_published: boolean
          long_description: string | null
          price: number | null
          rating_avg: number | null
          seller_id: string
          thumbnail_url: string | null
          title: string
          total_sales: number
        }
        Insert: {
          category?: string | null
          created_at?: string
          description?: string | null
          file_url?: string | null
          id?: string
          is_published?: boolean
          long_description?: string | null
          price?: number | null
          rating_avg?: number | null
          seller_id: string
          thumbnail_url?: string | null
          title: string
          total_sales?: number
        }
        Update: {
          category?: string | null
          created_at?: string
          description?: string | null
          file_url?: string | null
          id?: string
          is_published?: boolean
          long_description?: string | null
          price?: number | null
          rating_avg?: number | null
          seller_id?: string
          thumbnail_url?: string | null
          title?: string
          total_sales?: number
        }
        Relationships: [
          {
            foreignKeyName: "products_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      purchases: {
        Row: {
          amount: number | null
          created_at: string
          id: string
          product_id: string
          stripe_payment_id: string | null
          user_id: string
        }
        Insert: {
          amount?: number | null
          created_at?: string
          id?: string
          product_id: string
          stripe_payment_id?: string | null
          user_id: string
        }
        Update: {
          amount?: number | null
          created_at?: string
          id?: string
          product_id?: string
          stripe_payment_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchases_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          body: string | null
          created_at: string
          id: string
          product_id: string
          rating: number | null
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          product_id: string
          rating?: number | null
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          product_id?: string
          rating?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          billing_interval: string | null
          cancelled: boolean
          created_at: string
          ends_at: string | null
          id: string
          plan: string | null
          product_id: string | null
          provider: string
          provider_customer_id: string | null
          provider_subscription_id: string | null
          provider_updated_at: string | null
          renews_at: string | null
          status: string | null
          trial_ends_at: string | null
          user_id: string
          variant_id: string | null
        }
        Insert: {
          billing_interval?: string | null
          cancelled?: boolean
          created_at?: string
          ends_at?: string | null
          id?: string
          plan?: string | null
          product_id?: string | null
          provider?: string
          provider_customer_id?: string | null
          provider_subscription_id?: string | null
          provider_updated_at?: string | null
          renews_at?: string | null
          status?: string | null
          trial_ends_at?: string | null
          user_id: string
          variant_id?: string | null
        }
        Update: {
          billing_interval?: string | null
          cancelled?: boolean
          created_at?: string
          ends_at?: string | null
          id?: string
          plan?: string | null
          product_id?: string | null
          provider?: string
          provider_customer_id?: string | null
          provider_subscription_id?: string | null
          provider_updated_at?: string | null
          renews_at?: string | null
          status?: string | null
          trial_ends_at?: string | null
          user_id?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          affiliate_code: string | null
          avatar_url: string | null
          bio: string | null
          bonus_credits: number
          company_name: string | null
          country: string | null
          created_at: string
          credits_limit: number
          credits_used: number
          email: string
          id: string
          name: string | null
          notify_email: boolean
          notify_push: boolean
          onboarding_bonus_claimed: boolean
          onboarding_completed: boolean
          plan: string
          primary_goal: string | null
          revenue_goal_6m: number | null
          role: string
        }
        Insert: {
          affiliate_code?: string | null
          avatar_url?: string | null
          bio?: string | null
          bonus_credits?: number
          company_name?: string | null
          country?: string | null
          created_at?: string
          credits_limit?: number
          credits_used?: number
          email: string
          id: string
          name?: string | null
          notify_email?: boolean
          notify_push?: boolean
          onboarding_bonus_claimed?: boolean
          onboarding_completed?: boolean
          plan?: string
          primary_goal?: string | null
          revenue_goal_6m?: number | null
          role?: string
        }
        Update: {
          affiliate_code?: string | null
          avatar_url?: string | null
          bio?: string | null
          bonus_credits?: number
          company_name?: string | null
          country?: string | null
          created_at?: string
          credits_limit?: number
          credits_used?: number
          email?: string
          id?: string
          name?: string | null
          notify_email?: boolean
          notify_push?: boolean
          onboarding_bonus_claimed?: boolean
          onboarding_completed?: boolean
          plan?: string
          primary_goal?: string | null
          revenue_goal_6m?: number | null
          role?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      archive_ai_project: { Args: { p_project_id: string }; Returns: undefined }
      claim_ai_project_step: {
        Args: { p_project_id: string; p_step_id: string }
        Returns: {
          attempts: number
          brief_json: Json
          claimed: boolean
          credits_cost: number
          input_json: Json
          reason: string
          tool_key: string
        }[]
      }
      complete_ai_project_step: {
        Args: { p_generation_id: string; p_step_id: string }
        Returns: undefined
      }
      complete_onboarding: {
        Args: {
          p_bio: string
          p_company_name?: string
          p_country: string
          p_name: string
          p_primary_goal?: string
          p_revenue_goal_6m?: number
        }
        Returns: {
          bonus_granted: boolean
          credits_limit: number
          onboarding_completed: boolean
        }[]
      }
      confirm_ai_project_plan: {
        Args: { p_project_id: string }
        Returns: undefined
      }
      create_ai_project: {
        Args: {
          p_execution_mode?: string
          p_language?: string
          p_objective?: string
          p_original_idea: string
          p_target_audience?: string
        }
        Returns: string
      }
      fail_ai_project_step: {
        Args: {
          p_error_code: string
          p_error_message_safe: string
          p_pause_project: boolean
          p_step_id: string
        }
        Returns: undefined
      }
      generate_affiliate_code: { Args: never; Returns: string }
      generate_api_key: {
        Args: { p_name: string }
        Returns: {
          created_at: string
          id: string
          key_prefix: string
          plaintext_key: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      mark_step_credits_reserved: {
        Args: { p_step_id: string }
        Returns: undefined
      }
      pause_ai_project: { Args: { p_project_id: string }; Returns: undefined }
      process_lemon_squeezy_event: {
        Args: {
          p_cancelled: boolean
          p_customer_id: string
          p_ends_at: string
          p_event_id: string
          p_event_name: string
          p_invoice_total: number
          p_order_paid: boolean
          p_product_id: string
          p_provider_subscription_id: string
          p_provider_updated_at?: string
          p_renews_at: string
          p_secret: string
          p_status: string
          p_trial_ends_at: string
          p_user_id: string
          p_variant_id: string
        }
        Returns: {
          message: string
          notify_commission: number
          notify_email: string
          notify_kind: string
          notify_plan: string
          ok: boolean
        }[]
      }
      refund_credits: {
        Args: { p_cost: number }
        Returns: {
          credits_limit: number
          credits_used: number
        }[]
      }
      reserve_credits: {
        Args: { p_cost: number }
        Returns: {
          credits_limit: number
          credits_used: number
          ok: boolean
        }[]
      }
      resume_ai_project: { Args: { p_project_id: string }; Returns: undefined }
      save_ai_project_plan: {
        Args: {
          p_assumptions_json: Json
          p_brief_json: Json
          p_plan_json: Json
          p_project_id: string
          p_project_type: string
          p_steps: Json
          p_title: string
          p_total_credits: number
        }
        Returns: undefined
      }
      skip_ai_project_step: { Args: { p_step_id: string }; Returns: undefined }
      update_ai_project_brief: {
        Args: { p_brief_json: Json; p_project_id: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "user" | "admin"
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
    Enums: {
      app_role: ["user", "admin"],
    },
  },
} as const
