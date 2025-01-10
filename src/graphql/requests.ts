import { gql } from "@apollo/client";

// GraphQL запросы
export const GET_MESSAGES = gql`
  query GetMessages($first: Int, $after: MessagesCursor) {
    messages(first: $first, after: $after) {
      edges {
        node {
          id
          text
          status
          updatedAt
          sender
        }
        cursor
      }
      pageInfo {
        endCursor
        hasNextPage
      }
    }
  }
`;

export const SEND_MESSAGE = gql`
  mutation SendMessage($text: String!) {
    sendMessage(text: $text) {
      id
      text
      status
      updatedAt
      sender
    }
  }
`;

export const MESSAGE_ADDED = gql`
  subscription OnMessageAdded {
    messageAdded {
      id
      text
      status
      updatedAt
      sender
    }
  }
`;

export const MESSAGE_UPDATED = gql`
  subscription OnMessageUpdated {
    messageUpdated {
      id
      text
      status
      updatedAt
      sender
    }
  }
`;
