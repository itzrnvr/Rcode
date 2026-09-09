import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";

import type { MouseEventHandler, ReactNode } from "react";

export function AgentConversation({
  children,
  onContextMenu,
}: {
  children: ReactNode;
  onContextMenu?: MouseEventHandler<HTMLDivElement>;
}) {
  return (
    <Conversation className="rcode-conversation">
      <ConversationContent
        className="rcode-conversation-content"
        onContextMenu={onContextMenu}
      >
        {children}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}
