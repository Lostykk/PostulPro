-- Persistence for the Consultant chat tool. Kept as its own two tables
-- (conversations + messages) rather than overloading `generations`, since a
-- conversation is a growing list of turns, not a single generated artifact.

CREATE TABLE public.consultant_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.consultant_conversations TO authenticated;
GRANT ALL ON public.consultant_conversations TO service_role;
ALTER TABLE public.consultant_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own conversations" ON public.consultant_conversations FOR ALL TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.consultant_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.consultant_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.consultant_messages TO authenticated;
GRANT ALL ON public.consultant_messages TO service_role;
ALTER TABLE public.consultant_messages ENABLE ROW LEVEL SECURITY;

CREATE INDEX consultant_messages_conversation_id_idx ON public.consultant_messages(conversation_id);

CREATE POLICY "Own conversation messages" ON public.consultant_messages FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.consultant_conversations c
      WHERE c.id = conversation_id AND (c.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.consultant_conversations c
      WHERE c.id = conversation_id AND c.user_id = auth.uid()
    )
  );
