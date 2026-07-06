export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      cart: {
        Row: {
          created_at: string;
          guest_token: string | null;
          id: string;
          member_id: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          guest_token?: string | null;
          id?: string;
          member_id?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          guest_token?: string | null;
          id?: string;
          member_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cart_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "member";
            referencedColumns: ["id"];
          },
        ];
      };
      cart_item: {
        Row: {
          cart_id: string;
          config_snapshot: Json;
          created_at: string;
          id: string;
          product_id: string;
          quantity: number;
          unit_price_snapshot: number;
          updated_at: string;
        };
        Insert: {
          cart_id: string;
          config_snapshot: Json;
          created_at?: string;
          id?: string;
          product_id: string;
          quantity: number;
          unit_price_snapshot: number;
          updated_at?: string;
        };
        Update: {
          cart_id?: string;
          config_snapshot?: Json;
          created_at?: string;
          id?: string;
          product_id?: string;
          quantity?: number;
          unit_price_snapshot?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cart_item_cart_id_fkey";
            columns: ["cart_id"];
            isOneToOne: false;
            referencedRelation: "cart";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cart_item_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "product";
            referencedColumns: ["id"];
          },
        ];
      };
      member: {
        Row: {
          created_at: string;
          email: string;
          id: string;
          name: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          email: string;
          id: string;
          name?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          email?: string;
          id?: string;
          name?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      notification: {
        Row: {
          channel: string;
          created_at: string;
          id: string;
          order_id: string;
          sent_at: string | null;
          status: string;
          type: string;
        };
        Insert: {
          channel?: string;
          created_at?: string;
          id?: string;
          order_id: string;
          sent_at?: string | null;
          status?: string;
          type: string;
        };
        Update: {
          channel?: string;
          created_at?: string;
          id?: string;
          order_id?: string;
          sent_at?: string | null;
          status?: string;
          type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notification_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      option_type: {
        Row: {
          applies_to: Database["public"]["Enums"]["option_applies_to"];
          code: string;
          created_at: string;
          id: string;
          input_type: string;
          name: string;
          updated_at: string;
        };
        Insert: {
          applies_to: Database["public"]["Enums"]["option_applies_to"];
          code: string;
          created_at?: string;
          id?: string;
          input_type: string;
          name: string;
          updated_at?: string;
        };
        Update: {
          applies_to?: Database["public"]["Enums"]["option_applies_to"];
          code?: string;
          created_at?: string;
          id?: string;
          input_type?: string;
          name?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      option_value: {
        Row: {
          code: string;
          created_at: string;
          id: string;
          label: string;
          option_type_id: string;
          sort_order: number;
          updated_at: string;
        };
        Insert: {
          code: string;
          created_at?: string;
          id?: string;
          label: string;
          option_type_id: string;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          code?: string;
          created_at?: string;
          id?: string;
          label?: string;
          option_type_id?: string;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "option_value_option_type_id_fkey";
            columns: ["option_type_id"];
            isOneToOne: false;
            referencedRelation: "option_type";
            referencedColumns: ["id"];
          },
        ];
      };
      order_item: {
        Row: {
          config_snapshot: Json;
          created_at: string;
          id: string;
          order_id: string;
          product_id: string;
          product_name_snapshot: string | null;
          quantity: number;
          unit_price_snapshot: number;
        };
        Insert: {
          config_snapshot: Json;
          created_at?: string;
          id?: string;
          order_id: string;
          product_id: string;
          product_name_snapshot?: string | null;
          quantity: number;
          unit_price_snapshot: number;
        };
        Update: {
          config_snapshot?: Json;
          created_at?: string;
          id?: string;
          order_id?: string;
          product_id?: string;
          product_name_snapshot?: string | null;
          quantity?: number;
          unit_price_snapshot?: number;
        };
        Relationships: [
          {
            foreignKeyName: "order_item_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_item_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "product";
            referencedColumns: ["id"];
          },
        ];
      };
      order_status_log: {
        Row: {
          actor_id: string | null;
          created_at: string;
          from_status: string | null;
          id: string;
          is_override: boolean;
          note: string | null;
          order_id: string;
          to_status: string;
        };
        Insert: {
          actor_id?: string | null;
          created_at?: string;
          from_status?: string | null;
          id?: string;
          is_override?: boolean;
          note?: string | null;
          order_id: string;
          to_status: string;
        };
        Update: {
          actor_id?: string | null;
          created_at?: string;
          from_status?: string | null;
          id?: string;
          is_override?: boolean;
          note?: string | null;
          order_id?: string;
          to_status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "order_status_log_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "member";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_status_log_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      orders: {
        Row: {
          consent_at: string | null;
          created_at: string;
          custom_consent: boolean;
          id: string;
          invoice_no: string | null;
          invoice_status: Database["public"]["Enums"]["invoice_status"];
          member_id: string;
          order_no: string;
          recipient_name: string;
          recipient_phone: string;
          shipping_address: string;
          shipping_fee: number;
          status: Database["public"]["Enums"]["order_status"];
          subtotal: number;
          total_amount: number;
          tracking_no: string | null;
          updated_at: string;
          zip_code: string | null;
        };
        Insert: {
          consent_at?: string | null;
          created_at?: string;
          custom_consent?: boolean;
          id?: string;
          invoice_no?: string | null;
          invoice_status?: Database["public"]["Enums"]["invoice_status"];
          member_id: string;
          order_no: string;
          recipient_name: string;
          recipient_phone: string;
          shipping_address: string;
          shipping_fee?: number;
          status?: Database["public"]["Enums"]["order_status"];
          subtotal: number;
          total_amount: number;
          tracking_no?: string | null;
          updated_at?: string;
          zip_code?: string | null;
        };
        Update: {
          consent_at?: string | null;
          created_at?: string;
          custom_consent?: boolean;
          id?: string;
          invoice_no?: string | null;
          invoice_status?: Database["public"]["Enums"]["invoice_status"];
          member_id?: string;
          order_no?: string;
          recipient_name?: string;
          recipient_phone?: string;
          shipping_address?: string;
          shipping_fee?: number;
          status?: Database["public"]["Enums"]["order_status"];
          subtotal?: number;
          total_amount?: number;
          tracking_no?: string | null;
          updated_at?: string;
          zip_code?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "orders_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "member";
            referencedColumns: ["id"];
          },
        ];
      };
      payment: {
        Row: {
          amount: number;
          created_at: string;
          gateway_trade_no: string | null;
          id: string;
          last_reconciled_at: string | null;
          merchant_trade_no: string;
          order_id: string;
          paid_at: string | null;
          provider: string;
          raw_callback: Json | null;
          status: Database["public"]["Enums"]["payment_status"];
          updated_at: string;
        };
        Insert: {
          amount: number;
          created_at?: string;
          gateway_trade_no?: string | null;
          id?: string;
          last_reconciled_at?: string | null;
          merchant_trade_no: string;
          order_id: string;
          paid_at?: string | null;
          provider?: string;
          raw_callback?: Json | null;
          status?: Database["public"]["Enums"]["payment_status"];
          updated_at?: string;
        };
        Update: {
          amount?: number;
          created_at?: string;
          gateway_trade_no?: string | null;
          id?: string;
          last_reconciled_at?: string | null;
          merchant_trade_no?: string;
          order_id?: string;
          paid_at?: string | null;
          provider?: string;
          raw_callback?: Json | null;
          status?: Database["public"]["Enums"]["payment_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payment_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      product: {
        Row: {
          base_price: number;
          category: Database["public"]["Enums"]["product_category"];
          created_at: string;
          id: string;
          name: string;
          slug: string;
          status: Database["public"]["Enums"]["product_status"];
          updated_at: string;
        };
        Insert: {
          base_price: number;
          category: Database["public"]["Enums"]["product_category"];
          created_at?: string;
          id?: string;
          name: string;
          slug: string;
          status?: Database["public"]["Enums"]["product_status"];
          updated_at?: string;
        };
        Update: {
          base_price?: number;
          category?: Database["public"]["Enums"]["product_category"];
          created_at?: string;
          id?: string;
          name?: string;
          slug?: string;
          status?: Database["public"]["Enums"]["product_status"];
          updated_at?: string;
        };
        Relationships: [];
      };
      product_option: {
        Row: {
          created_at: string;
          id: string;
          option_type_id: string;
          product_id: string;
          required: boolean;
          sort_order: number;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          option_type_id: string;
          product_id: string;
          required?: boolean;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          option_type_id?: string;
          product_id?: string;
          required?: boolean;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_option_option_type_id_fkey";
            columns: ["option_type_id"];
            isOneToOne: false;
            referencedRelation: "option_type";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_option_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "product";
            referencedColumns: ["id"];
          },
        ];
      };
      product_option_value: {
        Row: {
          created_at: string;
          id: string;
          is_default: boolean;
          option_value_id: string;
          price_delta: number;
          product_option_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_default?: boolean;
          option_value_id: string;
          price_delta?: number;
          product_option_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_default?: boolean;
          option_value_id?: string;
          price_delta?: number;
          product_option_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_option_value_option_value_id_fkey";
            columns: ["option_value_id"];
            isOneToOne: false;
            referencedRelation: "option_value";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_option_value_product_option_id_fkey";
            columns: ["product_option_id"];
            isOneToOne: false;
            referencedRelation: "product_option";
            referencedColumns: ["id"];
          },
        ];
      };
      support_request: {
        Row: {
          created_at: string;
          description: string;
          id: string;
          member_id: string;
          order_id: string;
          request_type: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          description: string;
          id?: string;
          member_id: string;
          order_id: string;
          request_type: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          description?: string;
          id?: string;
          member_id?: string;
          order_id?: string;
          request_type?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "support_request_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "member";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "support_request_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      invoice_status: "none" | "issued" | "allowance" | "voided";
      option_applies_to: "all" | "ring" | "earring" | "bracelet" | "necklace";
      order_status:
        | "pending_payment"
        | "paid"
        | "in_production"
        | "shipped"
        | "completed"
        | "cancelled"
        | "refunded";
      payment_status: "pending" | "paid" | "failed" | "refunded";
      product_category: "ring" | "earring" | "bracelet" | "necklace";
      product_status: "draft" | "active" | "archived";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      invoice_status: ["none", "issued", "allowance", "voided"],
      option_applies_to: ["all", "ring", "earring", "bracelet", "necklace"],
      order_status: [
        "pending_payment",
        "paid",
        "in_production",
        "shipped",
        "completed",
        "cancelled",
        "refunded",
      ],
      payment_status: ["pending", "paid", "failed", "refunded"],
      product_category: ["ring", "earring", "bracelet", "necklace"],
      product_status: ["draft", "active", "archived"],
    },
  },
} as const;
