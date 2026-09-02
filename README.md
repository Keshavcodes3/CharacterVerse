# CharacterVerse 🎭🌌

> Create characters. Give them a mind. Enter their world.

CharacterVerse is an AI character platform where users can **create, customize, discover, and have persistent conversations with AI characters**.

The goal isn't to build another chatbot wrapper. CharacterVerse is being engineered as a **full-stack GenAI system** with character generation, model orchestration, streaming conversations, long-term memory, retrieval, background processing, and creator tooling.

## What We're Building

```text
                    CharacterVerse
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
    Characters       Conversations       Discovery
        │                 │                 │
        ▼                 ▼                 ▼
   Mistral AI        Gemini / Groq       Search
        │                 │                 │
        └─────────────────┼─────────────────┘
                          ▼
                     Memory Engine
                          │
                 ┌────────┴────────┐
                 ▼                 ▼
             PostgreSQL         Vector DB
                 │
                 ▼
             Redis / BullMQ
                 │
                 ▼
               Workers
```

## Core Features

### Users & Authentication

* User registration and login
* Session management
* OAuth
* User profiles
* Authorization
* Rate limiting

### Character Creation

Users can create characters manually or describe what they want and let AI generate the character.

Example:

> "Create me a sarcastic detective from 1940s Chicago who thinks someone is following him."

CharacterVerse uses **Mistral** to transform that idea into a structured character persona.

```json
{
  "name": "Elias Black",
  "personality": [
    "sarcastic",
    "observant",
    "paranoid"
  ],
  "backstory": "...",
  "speakingStyle": "...",
  "greeting": "...",
  "behaviorRules": [],
  "exampleDialogues": []
}
```

The generated output is validated before entering the application domain.

### AI Conversations

Users can have persistent conversations with characters.

```text
User
 ↓
API
 ↓
Conversation Service
 ↓
Context Builder
 ↓
Memory Retrieval
 ↓
Model Router
 ↓
Gemini / Groq
 ↓
Streaming
 ↓
User
```

### Persistent Memory

Characters will eventually support multiple layers of memory.

```text
Short-Term Memory
        │
        ▼
Recent Messages
        │
        ▼
Conversation Summary
        │
        ▼
Long-Term Memory
        │
        ▼
Semantic Retrieval
```

### Multi-Model Architecture

| Responsibility               | Model   |
| ---------------------------- | ------- |
| Character generation         | Mistral |
| Conversation                 | Gemini  |
| Fast conversation / fallback | Groq    |
| Embeddings                   | TBD     |
| Future specialized tasks     | TBD     |

CharacterVerse uses a **provider abstraction** rather than coupling the application to one LLM.

```ts
interface LLMProvider {
  generate(): Promise<LLMResponse>;
  stream(): AsyncIterable<LLMChunk>;
}
```

### Streaming

AI responses will be streamed to the client rather than waiting for the entire response.

```text
Client
  │
  │ POST message
  ▼
API
  │
  ▼
LLM
  │
  │ token stream
  ▼
SSE
  │
  ▼
Client
```

This lets us explore:

* Server-Sent Events
* Connection lifecycle
* Cancellation
* Backpressure
* Retries
* Partial responses
* Token accounting

### Character Discovery

Users will be able to discover characters through:

* Search
* Categories
* Tags
* Trending characters
* Popular characters
* Recently created characters
* Creator profiles

Eventually:

```text
Keyword Search
      +
Semantic Search
      +
Ranking
      ↓
Character Discovery
```

### Social Features

Planned:

* Like characters
* Follow creators
* Save characters
* Share characters
* Character collections
* Report characters
* Block users

### Creator Studio

Creators will eventually get analytics such as:

* Character views
* Conversations started
* Messages generated
* Likes
* Followers
* Returning users
* Conversation length
* Engagement

### Background Processing

Not every operation belongs inside an HTTP request.

```text
Character Created
       │
       ▼
     Queue
       │
 ┌─────┼──────────┐
 ▼     ▼          ▼
Embed  Index    Analytics
```

Planned infrastructure:

* Redis
* BullMQ
* Worker processes

## Architecture

CharacterVerse will initially follow a **modular monolith** architecture.

We deliberately aren't starting with microservices.

```text
                         API
                          │
          ┌───────────────┼────────────────┐
          ▼               ▼                ▼
       Auth           Characters        Chat
          │               │                │
          │               ▼                ▼
          │            Mistral         Model Router
          │                                │
          │                         ┌──────┴──────┐
          │                         ▼             ▼
          │                      Gemini         Groq
          │
          └───────────────┐
                          ▼
                     PostgreSQL
                          │
             ┌────────────┴────────────┐
             ▼                         ▼
           Redis                    Vector DB
             │
             ▼
           BullMQ
             │
             ▼
          Workers
```

## Tech Stack

### Frontend

* Next.js
* TypeScript
* Tailwind CSS

### Backend

* Node.js
* Express
* TypeScript
* Zod
* Pino

### Data

* PostgreSQL
* Prisma
* Redis
* Vector database

### AI

* Mistral
* Google Gemini
* Groq
* Embeddings
* RAG

### Infrastructure

* Docker
* BullMQ
* GitHub Actions

### Testing

* Vitest
* Supertest
* Load testing

## Roadmap

### Phase 1 · Foundation

* [ ] Project architecture
* [ ] PostgreSQL
* [ ] Prisma
* [ ] Authentication
* [ ] User system
* [ ] Character CRUD
* [ ] API validation
* [ ] Error handling
* [ ] OpenAPI documentation

### Phase 2 · Character Intelligence

* [ ] AI character generation
* [ ] Mistral integration
* [ ] Structured persona generation
* [ ] Character editing
* [ ] Character versioning
* [ ] Character playground

### Phase 3 · Conversations

* [ ] Conversations
* [ ] Messages
* [ ] Gemini integration
* [ ] Groq integration
* [ ] Model abstraction
* [ ] SSE streaming
* [ ] Token usage tracking

### Phase 4 · Memory

* [ ] Conversation summaries
* [ ] Memory extraction
* [ ] Embeddings
* [ ] Vector storage
* [ ] Semantic retrieval
* [ ] Context construction
* [ ] Long-term character memory

### Phase 5 · Platform

* [ ] Character discovery
* [ ] Search
* [ ] Categories
* [ ] Likes
* [ ] Follows
* [ ] Bookmarks
* [ ] Creator profiles

### Phase 6 · Infrastructure

* [ ] Redis
* [ ] BullMQ
* [ ] Background workers
* [ ] Caching
* [ ] Rate limiting
* [ ] Observability
* [ ] Metrics
* [ ] Distributed tracing

### Phase 7 · Production

* [ ] Load testing
* [ ] Failure handling
* [ ] Model fallbacks
* [ ] Horizontal scaling
* [ ] Database optimization
* [ ] Security hardening
* [ ] Cost optimization

## Engineering Goals

CharacterVerse is also a **90-day engineering project**.

The goal is to use the project to learn and implement:

```text
REST APIs
      ↓
Clean Architecture
      ↓
Database Internals
      ↓
Caching
      ↓
Concurrency
      ↓
Queues
      ↓
Distributed Systems
      ↓
LLM Systems
      ↓
RAG
      ↓
Agents
      ↓
Observability
      ↓
Production Scaling
```

Every major feature should teach us something rather than merely add another checkbox.

## Philosophy

> **Don't build a wrapper around an API. Build the system around the model.**

The LLM is only one component.

The real system is:

$$
\boxed{
User + Character + Context + Memory + Retrieval + Model + Infrastructure
}
$$
