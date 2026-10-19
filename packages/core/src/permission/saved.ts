export * as PermissionSaved from "./saved"

import { eq } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { ProjectV2 } from "../project"
import { PermissionTable } from "./sql"
import { PermissionSaved } from "@opencode-ai/schema/permission-saved"

export const ID = PermissionSaved.ID
export type ID = typeof ID.Type

export const Info = PermissionSaved.Info
export type Info = typeof Info.Type

export const ListInput = Schema.Struct({
  projectID: ProjectV2.ID.pipe(Schema.optional),
}).annotate({ identifier: "PermissionSaved.ListInput" })
export type ListInput = typeof ListInput.Type

export const AddInput = Schema.Struct({
  projectID: ProjectV2.ID,
  action: Schema.String,
  resources: Schema.Array(Schema.String),
}).annotate({ identifier: "PermissionSaved.AddInput" })
export type AddInput = typeof AddInput.Type

export const UpdateInput = Schema.Struct({
  id: ID,
  action: Schema.String.pipe(Schema.optional),
  resource: Schema.String.pipe(Schema.optional),
}).annotate({ identifier: "PermissionSaved.UpdateInput" })
export type UpdateInput = typeof UpdateInput.Type

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("PermissionSaved.NotFoundError", {
  id: ID,
}) {}

export class ConflictError extends Schema.TaggedErrorClass<ConflictError>()("PermissionSaved.ConflictError", {
  id: ID,
  action: Schema.String,
  resource: Schema.String,
}) {}

export interface Interface {
  readonly list: (input?: ListInput) => Effect.Effect<ReadonlyArray<Info>>
  readonly add: (input: AddInput) => Effect.Effect<void>
  readonly update: (input: UpdateInput) => Effect.Effect<Info, NotFoundError | ConflictError>
  readonly remove: (id: ID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/PermissionSaved") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    const list = Effect.fn("PermissionSaved.list")(function* (input?: ListInput) {
      const rows = yield* db
        .select()
        .from(PermissionTable)
        .where(input?.projectID ? eq(PermissionTable.project_id, input.projectID) : undefined)
        .all()
        .pipe(Effect.orDie)
      return rows.map(info)
    })

    const add = Effect.fn("PermissionSaved.add")(function* (input: AddInput) {
      if (!input.resources.length) return
      yield* db
        .insert(PermissionTable)
        .values(
          input.resources.map((resource) => ({
            id: ID.create(),
            project_id: input.projectID,
            action: input.action,
            resource,
          })),
        )
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
    })

    const update = Effect.fn("PermissionSaved.update")(function* (input: UpdateInput) {
      const current = yield* db
        .select()
        .from(PermissionTable)
        .where(eq(PermissionTable.id, input.id))
        .get()
        .pipe(Effect.orDie)
      if (!current) return yield* new NotFoundError({ id: input.id })
      const action = input.action ?? current.action
      const resource = input.resource ?? current.resource
      const updated = yield* db
        .update(PermissionTable)
        .set({ action, resource })
        .where(eq(PermissionTable.id, input.id))
        .returning()
        .get()
        .pipe(
          Effect.catch((error) =>
            isUniqueViolation(error)
              ? Effect.fail(new ConflictError({ id: input.id, action, resource }))
              : Effect.die(error),
          ),
        )
      if (!updated) return yield* new NotFoundError({ id: input.id })
      return info(updated)
    })

    const remove = Effect.fn("PermissionSaved.remove")(function* (id: ID) {
      yield* db.delete(PermissionTable).where(eq(PermissionTable.id, id)).run().pipe(Effect.orDie)
    })

    return Service.of({ list, add, update, remove })
  }),
)

const describeError = (error: unknown): string => {
  if (error instanceof Error) return `${error.message}${error.cause ? ` ${describeError(error.cause)}` : ""}`
  return String(error)
}

const isUniqueViolation = (error: unknown) =>
  /UNIQUE constraint failed|SQLITE_CONSTRAINT_UNIQUE/i.test(describeError(error))

const info = (row: typeof PermissionTable.$inferSelect): Info => ({
  id: row.id,
  projectID: row.project_id,
  action: row.action,
  resource: row.resource,
})

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })
