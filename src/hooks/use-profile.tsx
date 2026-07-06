import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export type Profile = {
  id: string;
  name: string | null;
  email: string;
  avatar_url: string | null;
  bio: string | null;
  plan: "free" | "pro" | "business";
  credits_used: number;
  credits_limit: number;
  affiliate_code: string | null;
  onboarding_completed: boolean;
  notify_email: boolean;
  notify_push: boolean;
  created_at: string;
};

type Ctx = {
  profile: Profile | null;
  loading: boolean;
  refresh: () => Promise<void>;
};

const ProfileContext = createContext<Ctx>({ profile: null, loading: true, refresh: async () => {} });

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setProfile(null);
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from("users")
      .select(
        "id,name,email,avatar_url,bio,plan,credits_used,credits_limit,affiliate_code,onboarding_completed,notify_email,notify_push,created_at",
      )
      .eq("id", user.id)
      .maybeSingle();
    setProfile((data as Profile | null) ?? null);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <ProfileContext.Provider value={{ profile, loading, refresh }}>{children}</ProfileContext.Provider>
  );
}

export const useProfile = () => useContext(ProfileContext);
