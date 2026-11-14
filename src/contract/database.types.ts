
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "ai_turns": {
                  Row: {
                    "conversation_id": string | null,"created_at": string,"handoff_offer": Database["public"]['Enums']["handoff_reason"] | null,"handoff_reason": Database["public"]['Enums']["handoff_reason"] | null,"id": string,"input_tokens": number,"latency_ms": number,"mode": Database["public"]['Enums']["engine_mode"],"model": string | null,"model_calls": number,"output_tokens": number,"postcheck": Json | null,"prompt_version": string | null,"shop_id": string,"tool_calls": NonNullable<Json>,"ttft_ms": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "conversation_id"?: string | null,"created_at"?: string,"handoff_offer"?: Database["public"]['Enums']["handoff_reason"] | null,"handoff_reason"?: Database["public"]['Enums']["handoff_reason"] | null,"id"?: string,"input_tokens"?: number,"latency_ms": number,"mode": Database["public"]['Enums']["engine_mode"],"model"?: string | null,"model_calls"?: number,"output_tokens"?: number,"postcheck"?: Json | null,"prompt_version"?: string | null,"shop_id": string,"tool_calls"?: NonNullable<Json>,"ttft_ms"?: number | null
                  }
                  Update: {
                    "conversation_id"?: string | null,"created_at"?: string,"handoff_offer"?: Database["public"]['Enums']["handoff_reason"] | null,"handoff_reason"?: Database["public"]['Enums']["handoff_reason"] | null,"id"?: string,"input_tokens"?: number,"latency_ms"?: number,"mode"?: Database["public"]['Enums']["engine_mode"],"model"?: string | null,"model_calls"?: number,"output_tokens"?: number,"postcheck"?: Json | null,"prompt_version"?: string | null,"shop_id"?: string,"tool_calls"?: NonNullable<Json>,"ttft_ms"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_turns_conversation_id_shop_id_fkey"
      columns: ["conversation_id","shop_id"]
isOneToOne: false
      referencedRelation: "conversations"
      referencedColumns: ["id","shop_id"]
    },{
      foreignKeyName: "ai_turns_shop_id_fkey"
      columns: ["shop_id"]
isOneToOne: false
      referencedRelation: "shops"
      referencedColumns: ["id"]
    }
                  ]
                },"channel_accounts": {
                  Row: {
                    "access_token": string,"channel": Database["public"]['Enums']["channel"],"created_at": string,"external_account_id": string,"id": string,"shop_id": string,"webhook_secret": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "access_token": string,"channel": Database["public"]['Enums']["channel"],"created_at"?: string,"external_account_id": string,"id"?: string,"shop_id": string,"webhook_secret"?: string | null
                  }
                  Update: {
                    "access_token"?: string,"channel"?: Database["public"]['Enums']["channel"],"created_at"?: string,"external_account_id"?: string,"id"?: string,"shop_id"?: string,"webhook_secret"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "channel_accounts_shop_id_fkey"
      columns: ["shop_id"]
isOneToOne: false
      referencedRelation: "shops"
      referencedColumns: ["id"]
    }
                  ]
                },"channel_events": {
                  Row: {
                    "channel_account_id": string,"external_message_id": string,"received_at": string,"shop_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "channel_account_id": string,"external_message_id": string,"received_at"?: string,"shop_id": string
                  }
                  Update: {
                    "channel_account_id"?: string,"external_message_id"?: string,"received_at"?: string,"shop_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "channel_events_channel_account_id_shop_id_fkey"
      columns: ["channel_account_id","shop_id"]
isOneToOne: false
      referencedRelation: "channel_accounts"
      referencedColumns: ["id","shop_id"]
    }
                  ]
                },"conversations": {
                  Row: {
                    "created_at": string,"id": string,"last_message_at": string,"latest_shopper_message_at": string | null,"latest_shopper_message_id": string | null,"mode": Database["public"]['Enums']["conversation_mode"],"shop_id": string,"shopper_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"last_message_at"?: string,"latest_shopper_message_at"?: string | null,"latest_shopper_message_id"?: string | null,"mode"?: Database["public"]['Enums']["conversation_mode"],"shop_id": string,"shopper_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"last_message_at"?: string,"latest_shopper_message_at"?: string | null,"latest_shopper_message_id"?: string | null,"mode"?: Database["public"]['Enums']["conversation_mode"],"shop_id"?: string,"shopper_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "conversations_shopper_id_shop_id_fkey"
      columns: ["shopper_id","shop_id"]
isOneToOne: false
      referencedRelation: "shoppers"
      referencedColumns: ["id","shop_id"]
    }
                  ]
                },"messages": {
                  Row: {
                    "client_message_id": string | null,"conversation_id": string,"created_at": string,"id": string,"photo_paths": (string)[],"reply": Json | null,"sender": Database["public"]['Enums']["message_sender"],"shop_id": string,"staff_id": string | null,"text": string
                  }
                  ComputedFields: never
                  Insert: {
                    "client_message_id"?: string | null,"conversation_id": string,"created_at"?: string,"id"?: string,"photo_paths"?: (string)[],"reply"?: Json | null,"sender": Database["public"]['Enums']["message_sender"],"shop_id": string,"staff_id"?: string | null,"text"?: string
                  }
                  Update: {
                    "client_message_id"?: string | null,"conversation_id"?: string,"created_at"?: string,"id"?: string,"photo_paths"?: (string)[],"reply"?: Json | null,"sender"?: Database["public"]['Enums']["message_sender"],"shop_id"?: string,"staff_id"?: string | null,"text"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "messages_conversation_id_shop_id_fkey"
      columns: ["conversation_id","shop_id"]
isOneToOne: false
      referencedRelation: "conversations"
      referencedColumns: ["id","shop_id"]
    },{
      foreignKeyName: "messages_staff_id_shop_id_fkey"
      columns: ["staff_id","shop_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","shop_id"]
    }
                  ]
                },"order_items": {
                  Row: {
                    "id": string,"line_total": number,"order_id": string,"quantity": number,"shop_id": string,"unit_price": number,"variant_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: string,"line_total"?: never,"order_id": string,"quantity": number,"shop_id": string,"unit_price": number,"variant_id": string
                  }
                  Update: {
                    "id"?: string,"line_total"?: never,"order_id"?: string,"quantity"?: number,"shop_id"?: string,"unit_price"?: number,"variant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "order_items_order_id_shop_id_fkey"
      columns: ["order_id","shop_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id","shop_id"]
    },{
      foreignKeyName: "order_items_variant_id_shop_id_fkey"
      columns: ["variant_id","shop_id"]
isOneToOne: false
      referencedRelation: "variants"
      referencedColumns: ["id","shop_id"]
    }
                  ]
                },"orders": {
                  Row: {
                    "cancelled_at": string | null,"cancelled_by": string | null,"confirmed_at": string | null,"confirmed_by": string | null,"conversation_id": string,"created_at": string,"customer_address": string,"customer_name": string,"customer_phone": string,"id": string,"quote_key": string | null,"shop_id": string,"status": Database["public"]['Enums']["order_status"],"total": number
                  }
                  ComputedFields: never
                  Insert: {
                    "cancelled_at"?: string | null,"cancelled_by"?: string | null,"confirmed_at"?: string | null,"confirmed_by"?: string | null,"conversation_id": string,"created_at"?: string,"customer_address": string,"customer_name": string,"customer_phone": string,"id"?: string,"quote_key"?: string | null,"shop_id": string,"status"?: Database["public"]['Enums']["order_status"],"total": number
                  }
                  Update: {
                    "cancelled_at"?: string | null,"cancelled_by"?: string | null,"confirmed_at"?: string | null,"confirmed_by"?: string | null,"conversation_id"?: string,"created_at"?: string,"customer_address"?: string,"customer_name"?: string,"customer_phone"?: string,"id"?: string,"quote_key"?: string | null,"shop_id"?: string,"status"?: Database["public"]['Enums']["order_status"],"total"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "orders_cancelled_by_shop_id_fkey"
      columns: ["cancelled_by","shop_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","shop_id"]
    },{
      foreignKeyName: "orders_confirmed_by_shop_id_fkey"
      columns: ["confirmed_by","shop_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","shop_id"]
    },{
      foreignKeyName: "orders_conversation_id_shop_id_fkey"
      columns: ["conversation_id","shop_id"]
isOneToOne: false
      referencedRelation: "conversations"
      referencedColumns: ["id","shop_id"]
    }
                  ]
                },"pairings": {
                  Row: {
                    "id": string,"product_a_id": string,"product_b_id": string,"reason": string,"shop_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: string,"product_a_id": string,"product_b_id": string,"reason": string,"shop_id": string
                  }
                  Update: {
                    "id"?: string,"product_a_id"?: string,"product_b_id"?: string,"reason"?: string,"shop_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "pairings_product_a_id_shop_id_fkey"
      columns: ["product_a_id","shop_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id","shop_id"]
    },{
      foreignKeyName: "pairings_product_b_id_shop_id_fkey"
      columns: ["product_b_id","shop_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id","shop_id"]
    }
                  ]
                },"policies": {
                  Row: {
                    "content": string,"kind": Database["public"]['Enums']["policy_kind"],"shop_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "content"?: string,"kind": Database["public"]['Enums']["policy_kind"],"shop_id": string
                  }
                  Update: {
                    "content"?: string,"kind"?: Database["public"]['Enums']["policy_kind"],"shop_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "policies_shop_id_fkey"
      columns: ["shop_id"]
isOneToOne: false
      referencedRelation: "shops"
      referencedColumns: ["id"]
    }
                  ]
                },"product_images": {
                  Row: {
                    "created_at": string,"id": string,"position": number,"product_id": string,"shop_id": string,"url": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"position": number,"product_id": string,"shop_id": string,"url": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"position"?: number,"product_id"?: string,"shop_id"?: string,"url"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "product_images_product_id_shop_id_fkey"
      columns: ["product_id","shop_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id","shop_id"]
    },{
      foreignKeyName: "product_images_shop_id_fkey"
      columns: ["shop_id"]
isOneToOne: false
      referencedRelation: "shops"
      referencedColumns: ["id"]
    }
                  ]
                },"products": {
                  Row: {
                    "category": string | null,"code": string,"created_at": string,"description": string | null,"id": string,"image_url": string | null,"name": string,"price": number,"shop_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "category"?: string | null,"code": string,"created_at"?: string,"description"?: string | null,"id"?: string,"image_url"?: string | null,"name": string,"price": number,"shop_id": string
                  }
                  Update: {
                    "category"?: string | null,"code"?: string,"created_at"?: string,"description"?: string | null,"id"?: string,"image_url"?: string | null,"name"?: string,"price"?: number,"shop_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "products_shop_id_fkey"
      columns: ["shop_id"]
isOneToOne: false
      referencedRelation: "shops"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"full_name": string | null,"id": string,"role": Database["public"]['Enums']["profile_role"],"shop_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"full_name"?: string | null,"id": string,"role": Database["public"]['Enums']["profile_role"],"shop_id": string
                  }
                  Update: {
                    "created_at"?: string,"full_name"?: string | null,"id"?: string,"role"?: Database["public"]['Enums']["profile_role"],"shop_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "profiles_shop_id_fkey"
      columns: ["shop_id"]
isOneToOne: false
      referencedRelation: "shops"
      referencedColumns: ["id"]
    }
                  ]
                },"shoppers": {
                  Row: {
                    "channel": Database["public"]['Enums']["channel"],"channel_account_id": string | null,"created_at": string,"display_name": string | null,"external_id": string,"id": string,"shop_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "channel": Database["public"]['Enums']["channel"],"channel_account_id"?: string | null,"created_at"?: string,"display_name"?: string | null,"external_id": string,"id"?: string,"shop_id": string
                  }
                  Update: {
                    "channel"?: Database["public"]['Enums']["channel"],"channel_account_id"?: string | null,"created_at"?: string,"display_name"?: string | null,"external_id"?: string,"id"?: string,"shop_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "shoppers_channel_account_id_channel_shop_id_fkey"
      columns: ["channel_account_id","channel","shop_id"]
isOneToOne: false
      referencedRelation: "channel_accounts"
      referencedColumns: ["id","channel","shop_id"]
    },{
      foreignKeyName: "shoppers_shop_id_fkey"
      columns: ["shop_id"]
isOneToOne: false
      referencedRelation: "shops"
      referencedColumns: ["id"]
    }
                  ]
                },"shops": {
                  Row: {
                    "address": string | null,"banner_url": string | null,"created_at": string,"fanpage_url": string | null,"id": string,"name": string,"phone": string | null,"slug": string
                  }
                  ComputedFields: never
                  Insert: {
                    "address"?: string | null,"banner_url"?: string | null,"created_at"?: string,"fanpage_url"?: string | null,"id"?: string,"name": string,"phone"?: string | null,"slug": string
                  }
                  Update: {
                    "address"?: string | null,"banner_url"?: string | null,"created_at"?: string,"fanpage_url"?: string | null,"id"?: string,"name"?: string,"phone"?: string | null,"slug"?: string
                  }
                  Relationships: [
                    
                  ]
                },"size_charts": {
                  Row: {
                    "height_max_cm": number,"height_min_cm": number,"id": string,"product_id": string,"shop_id": string,"size": string,"weight_max_kg": number,"weight_min_kg": number
                  }
                  ComputedFields: never
                  Insert: {
                    "height_max_cm": number,"height_min_cm": number,"id"?: string,"product_id": string,"shop_id": string,"size": string,"weight_max_kg": number,"weight_min_kg": number
                  }
                  Update: {
                    "height_max_cm"?: number,"height_min_cm"?: number,"id"?: string,"product_id"?: string,"shop_id"?: string,"size"?: string,"weight_max_kg"?: number,"weight_min_kg"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "size_charts_product_id_shop_id_fkey"
      columns: ["product_id","shop_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id","shop_id"]
    }
                  ]
                },"variants": {
                  Row: {
                    "color": string,"id": string,"product_id": string,"shop_id": string,"size": string,"stock": number
                  }
                  ComputedFields: never
                  Insert: {
                    "color": string,"id"?: string,"product_id": string,"shop_id": string,"size": string,"stock": number
                  }
                  Update: {
                    "color"?: string,"id"?: string,"product_id"?: string,"shop_id"?: string,"size"?: string,"stock"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "variants_product_id_shop_id_fkey"
      columns: ["product_id","shop_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id","shop_id"]
    }
                  ]
                },"web_chat_hits": {
                  Row: {
                    "client_hash": string,"created_at": string,"id": number,"new_shopper": boolean,"shop_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "client_hash": string,"created_at"?: string,"id"?: never,"new_shopper": boolean,"shop_id": string
                  }
                  Update: {
                    "client_hash"?: string,"created_at"?: string,"id"?: never,"new_shopper"?: boolean,"shop_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "web_chat_hits_shop_id_fkey"
      columns: ["shop_id"]
isOneToOne: false
      referencedRelation: "shops"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "decide_draft_order":
{ Args: { "p_decision": Database["public"]['Enums']["order_status"],"p_order_id": string }; Returns: Json
                           },
"engine_create_draft_order":
{ Args: { "p_conversation_id": string,"p_customer_address": string,"p_customer_name": string,"p_customer_phone": string,"p_expected_prices": Json,"p_items": Json,"p_quote_key": string,"p_shop_id": string }; Returns: Json
                           },
"engine_resume_ai":
{ Args: { "p_conversation_id": string,"p_message_id": string,"p_shop_id": string }; Returns: boolean
                           },
"engine_order_for_quote":
{ Args: { "p_conversation_id": string,"p_quote_key": string,"p_shop_id": string,"p_supersede": boolean }; Returns: Json
                           },
"engine_search_products":
{ Args: { "p_limit": number,"p_query": string,"p_shop_id": string }; Returns: {
              "category": string | null,
"code": string,
"created_at": string,
"description": string | null,
"id": string,
"image_url": string | null,
"name": string,
"price": number,
"shop_id": string
            }[]
                          SetofOptions: {
        from: "*"
        to: "products"
        isOneToOne: false
        isSetofReturn: true
      } },
"inbox_counts":
{ Args: { "p_channel"?: Database["public"]['Enums']["channel"],"p_query"?: string }; Returns: {
              "ai": number,"needs_human": number,"staff": number,"total": number
            }[]
                           },
"save_product_images":
{ Args: { "p_product_id": string,"p_urls": Json }; Returns: number
                           },
"save_size_chart":
{ Args: { "p_product_id": string,"p_rows": Json }; Returns: number
                           },
"search_inbox":
{ Args: { "p_after_at"?: string,"p_after_id"?: string,"p_after_urgent"?: boolean,"p_channel"?: Database["public"]['Enums']["channel"],"p_limit"?: number,"p_mode"?: Database["public"]['Enums']["conversation_mode"],"p_query"?: string }; Returns: {
              "channel": Database["public"]['Enums']["channel"],"customer_message": string,"customer_message_at": string,"display_name": string,"id": string,"last_message_at": string,"latest_message": string,"mode": Database["public"]['Enums']["conversation_mode"]
            }[]
                           },
"web_chat_take":
{ Args: { "p_client_hash": string,"p_client_per_minute": number,"p_client_shop_per_minute": number,"p_new_shopper": boolean,"p_new_shoppers_per_hour": number,"p_shop_id": string,"p_shop_per_minute": number }; Returns: string
                           }
          }
          Enums: {
            "channel": "web"|"messenger"|"instagram"|"telegram"|"whatsapp","conversation_mode": "ai"|"needs_human"|"staff","engine_mode": "customer"|"staff_draft","handoff_reason": "complaint"|"asked_for_human"|"not_covered_by_data"|"product_not_found"|"misunderstood_twice"|"size_out_of_range"|"policy_not_covered"|"postcheck_failed"|"too_many_tool_calls","message_sender": "shopper"|"ai"|"staff"|"system","order_status": "draft"|"confirmed"|"cancelled","policy_kind": "doi_tra"|"giao_hang"|"khuyen_mai","profile_role": "owner"|"staff"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "channel": ["web", "messenger", "instagram", "telegram", "whatsapp"],"conversation_mode": ["ai", "needs_human", "staff"],"engine_mode": ["customer", "staff_draft"],"handoff_reason": ["complaint", "asked_for_human", "not_covered_by_data", "product_not_found", "misunderstood_twice", "size_out_of_range", "policy_not_covered", "postcheck_failed", "too_many_tool_calls"],"message_sender": ["shopper", "ai", "staff", "system"],"order_status": ["draft", "confirmed", "cancelled"],"policy_kind": ["doi_tra", "giao_hang", "khuyen_mai"],"profile_role": ["owner", "staff"]
          }
        }
} as const
