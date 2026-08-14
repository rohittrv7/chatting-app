# ADR 0001: Choice of Prisma as Backend ORM

## Context
The NestJS backend requires a strong, type-safe Object-Relational Mapping (ORM) framework to interact with PostgreSQL. We need strict schema definitions, automated migration generation, compile-time type inference, and strong relational constraint enforcement.

## Decision
We choose **Prisma ORM** as the database layer for the NestJS backend.

## Consequences
- **Type Safety:** Auto-generated TypeScript client from `schema.prisma` guarantees complete alignment between database schema and API DTOs with zero manual boilerplate.
- **Migration Pipeline:** Native support for declarative migrations (`prisma migrate dev`) and explicit rollback/history tracking.
- **Parameterization:** Automatic protection against SQL injection vulnerabilities.
- **Repository Pattern Compatibility:** Easily wrapped inside NestJS repository classes to maintain Clean Architecture decoupled boundaries.

## Alternatives Considered
- **TypeORM:** Higher runtime flexibility with Active Record pattern, but prone to sync issues and loose dynamic querying risks.
- **Kysely / Knex:** Query builders offering lower-level SQL control, but require manual DTO synchronization and lacks declarative schema definition out of the box.
