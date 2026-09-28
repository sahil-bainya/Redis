# Redis 

**Universal rules :**
- Redis only stores **strings** — objects must be `JSON.stringify`'d before storing and `JSON.parse`'d after reading.
- A missing key is **not an error** — `GET`/`HGETALL`/`RPOP` return `nil`/`{}`/`null`.
- Keys with no elements left **auto-delete** (hashes, lists).
- One Redis client is created once at startup and reused — never per request.

---
## 📚 Index

1. [Setup](#01--setup)
2. [Site Banner](#02--site-banner)
3. [Login OTP with TTL](#03--login-otp-with-ttl)
4. [User Profile Cache — JSON vs Hash](#04--user-profile-cache--json-vs-hash)
5. [Email Queue with Redis Lists](#05--email-queue-with-redis-lists)
6. [Order Confirmation Jobs with BullMQ](#06--order-confirmation-jobs-with-bullmq)
7. [Live Admin Notification — Pub/Sub](#07--live-admin-notification--pubsub)

---

## 01 · Setup

Started by connecting the app to a Redis server using `ioredis`. Redis runs as a separate process on port `6379`, and the client talks to it over TCP via the Redis URL.

The only Redis command here is:

```
PING   →   returns "PONG" if the server is reachable
```

`PING` is the standard health check — it proves the connection is alive without touching any data.

```js
const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");
const reply = await redis.ping();
```

The client is created **once at module load** and reused. Every Redis command in `ioredis` returns a promise, so `await` works naturally. At this stage no data structure is touched — the point is just confirming the connection works before moving on.

---

## 02 · Site Banner

First real data project — storing a single editable string (an announcement banner) in Redis.

The data type here is **Strings**: one key → one value. This is the most basic Redis type and the foundation for caching, flags, and simple config.

Commands used:

```
SET key value     →  create or overwrite the key
GET key           →  read the value; nil if missing
DEL key           →  delete; returns 1 if existed, 0 if not
EXISTS key        →  1 or 0 (cheaper than GET when you only need existence)
```

```js
const BANNER_KEY = "app:banner";        // ":" separates namespaces
await redis.set(BANNER_KEY, message);   // create or overwrite
await redis.get(BANNER_KEY);            // read
await redis.del(BANNER_KEY);            // remove
await redis.exists(BANNER_KEY);         // 1 or 0
```

**Use case:** site-wide config that admins update without redeploying — banners, feature flags, maintenance mode.

Two things clicked here:
- Redis has **no "update" command**. `SET` handles both insert and update. Big mental shift from SQL.
- `EXISTS` returns `0`/`1`, not a boolean — cast it yourself if needed.

`app:banner` uses a `:` to namespace keys. This isn't a Redis requirement, but it's the standard convention to group related keys in a shared Redis instance.

---

## 03 · Login OTP with TTL

Built an OTP flow where the code is only valid for 30 seconds.

The key idea is **expiration (TTL)** — you attach a time-to-live to any key, and Redis deletes it automatically when the timer runs out. No cron job, no cleanup code.

```
SET key value EX <seconds>   →  set with expiry (PX = ms; EXAT/PXAT = absolute time)
TTL key                      →  remaining seconds
GET key                      →  returns nil once expired
DEL key                      →  manual delete (used here to "consume" the OTP)
```

```js
await redis.set(`otp:${phone}`, otp, "EX", 30);   // 30-second TTL
const savedOtp = await redis.get(`otp:${phone}`); // nil if expired
await redis.del(`otp:${phone}`);                  // consume after verify
const ttl = await redis.ttl(`otp:${phone}`);      // seconds left
```

`TTL` return values carry meaning:

```
positive number  →  seconds left before expiry
-1               →  key exists but has no expiry
-2               →  key does not exist (never set, or already expired)
```

**Use case:** OTPs, password-reset tokens, email-verification links, short-lived sessions.

Two things worth remembering:
- Overwriting a key **resets its TTL** unless you pass `KEEPTTL`. `SET` wipes the previous expiry.
- **Delete-after-use is not optional.** TTL only cleans up unused OTPs. To prevent replay attacks, delete the OTP after successful verification.

Expired keys behave as if they never existed — `GET` returns `nil`, `EXISTS` returns `0`. There's no "expired" state you can query directly; `TTL`'s `-2` is the closest signal.

---

## 04 · User Profile Cache — JSON vs Hash

Cached a user object two different ways to compare.

The new type here is **Hashes** — one key → many field/value pairs. Hashes let Redis read, write, or delete individual fields without touching the rest of the object.

Two ways to store an object:
1. **JSON string** — `SET` the object serialized as a string.
2. **Hash** — `HSET` each field natively.

Hash commands:

```
HSET key f v [f v ...]   →  set one or more fields; creates the hash if missing
HGET key f               →  read one field
HGETALL key              →  read all fields as an object
HDEL key f               →  delete one or more fields
HEXISTS key f            →  1 or 0 for a specific field
```

```js
// JSON way
await redis.set(`user:${id}:json`, JSON.stringify(req.body));
const raw = await redis.get(`user:${id}:json`);
JSON.parse(raw);

// Hash way
await redis.hset(`user:${id}:hash`, req.body);
await redis.hgetall(`user:${id}:hash`);
await redis.hget(`user:${id}:hash`, "email");   // one field
await redis.hdel(`user:${id}:hash`, "age");     // one field
```

Why hashes exist:

```
JSON string        Hash
─────────────      ─────────────
Update one field   must read + rewrite the whole blob   →  HSET just that field
Read one field     must deserialize the whole blob      →  HGET
Nested objects     supported                            →  flat only
Best for           complex, whole-object access         →  frequent per-field access
```

**Use case:** user profiles, product metadata, session data — anything you frequently read or update field-by-field.

The reason hashes exist clicked here: **Redis strings are immutable.** You can't "edit" a JSON blob in place — you must read the whole thing, modify it, and write it back. That's the exact problem hashes solve.

A few more details:
- Hashes are **flat** — no nested objects or arrays.
- Field values are still strings (`"25"`, not `25`).
- `HGETALL` on a missing key returns `{}`.
- Deleting all fields deletes the key.
- TTL applies to the whole hash, not individual fields.

---

## 05 · Email Queue with Redis Lists

Built a simple producer/consumer email queue.

The new type is **Lists** — an ordered collection where you push and pop from either end. Makes a natural queue.

```
LPUSH + RPOP   →  FIFO queue
LPUSH + LPOP   →  LIFO stack
```

```
LPUSH key value [value ...]   →  insert at the head (left); creates list if missing
RPOP key                      →  remove + return from the tail (right); nil if empty
```

Related commands I looked up but didn't need: `RPUSH`, `LPOP`, `LRANGE`, `LLEN`, `BRPOP` (blocking pop).

```js
await redis.lpush("queue:emails", JSON.stringify(job));   // producer
const rawJob = await redis.rpop("queue:emails");          // consumer
if (!rawJob) return;                                      // queue empty
const job = JSON.parse(rawJob);
```

**Use case:** simple background jobs — email sending, image resizing, webhook dispatch.

Three limits of a plain list as a queue — these become the motivation for the next project:

1. **Job loss** — `RPOP` removes the job immediately. If the worker crashes mid-processing, the job is gone. There's no acknowledgement step.
2. **No retry** — a failed job just disappears. No requeue, no failure tracking.
3. **No parallel-worker coordination** — multiple consumers *can* safely pop from Redis (each element goes to exactly one caller), but there's no visibility into in-flight jobs.

`BRPOP` is the blocking alternative — it waits for an element instead of polling in a loop.
<img width="787" height="433" alt="image" src="https://github.com/user-attachments/assets/6766a66c-b568-4bb7-ac78-9ac669e98854" />

<!-- DIAGRAM: 05-list-queue -->

---

## 06 · Order Confirmation Jobs with BullMQ

Rebuilt the queue properly using **BullMQ** — a job queue library that stores its entire state inside Redis.

BullMQ fixes the three issues from the previous project:

```
Project 05 issue            Fix in BullMQ
──────────────────          ──────────────────────────────────
Job loss                    Job states tracked in Redis (waiting → active
                            → completed/failed); recoverable
No retry                    attempts: 3 — re-enqueued up to 3 times
No parallel workers         Multiple Worker processes pull from the same queue
```

Under the hood BullMQ uses several Redis structures:

```
Lists         →  waiting jobs
Sorted sets   →  delayed / retry-scheduled jobs (scored by "run-at" timestamp)
Hashes        →  each job's payload + metadata (name, data, attempts)
Pub/Sub       →  waking workers when a new job arrives
```

```js
// Producer
emailQueue.add("send-welcome-email", { to, name }, {
  attempts: 3,
  backoff: { type: "exponential", delay: 1000 },
});

// Worker
new Worker("emails", async (job) => { /* process */ }, { connection });

worker.on("completed", (job) => { /* ... */ });
worker.on("failed", (job, err) => { /* ... */ });
```

`backoff` is the delay between retries. `exponential` doubles the wait after each failure — implemented as a Redis **sorted set** scored by when the job should run again.

A few things to remember:
- Workers **pull**; Redis coordinates. That's what makes parallel workers safe.
- Default concurrency is **1 job at a time per worker process**. Pass `{ concurrency: N }` to parallelize within one process.
- BullMQ opens its **own Redis connections** — separate from any `ioredis` client elsewhere in the app.
- `worker.on("completed")` / `worker.on("failed")` are **BullMQ events**, not Redis commands.
- `job.id` is assigned by BullMQ, not Redis.

**Files:**
```
queue.js    →  defines Queue + shared Redis connection config
api.js      →  producer; POST /welcome-email enqueues a job
worker.js   →  consumer; processes jobs + listens to completed/failed events
```

<img width="1011" height="454" alt="image" src="https://github.com/user-attachments/assets/7ad5aeec-6b20-4fd5-b78d-48101249d4dd" />

---

## 07 · Live Admin Notification (Pub/Sub)

Real-time notifications pushed to every connected admin.

The last new primitive is **Pub/Sub** — publisher sends to a channel, Redis fans it out instantly to all clients currently subscribed.

```
PUBLISH channel message       →  returns number of subscribers that received it
SUBSCRIBE channel [channel]   →  puts the connection into subscriber mode
PSUBSCRIBE pattern            →  subscribe to a namespace (e.g. notif:*)
UNSUBSCRIBE                   →  leave a channel
```

```js
// Publisher
const receivers = await publisher.publish("notification", JSON.stringify(payload));

// Subscriber (separate connection)
subscriber.subscribe("notification");
subscriber.on("message", (channel, message) => {
  console.log(channel, JSON.parse(message));
});
```

**Use case:** live admin dashboards, chat, real-time alerts, cache invalidation broadcasts.

Things that mattered:

- A **channel is not a key** — no value, no `GET`/`EXISTS`. Just a routing name.
- **No persistence, no redelivery.** Offline subscribers miss the message forever. If you `PUBLISH` to a channel with 0 subscribers, it returns `0` and the message vanishes — no error.
- A subscribed connection **cannot run regular commands** — you must use **separate connections** for publishing and subscribing. `ioredis` puts the connection into subscriber mode on `subscribe`, which is why `api.js` and `subscriber.js` each create their own client.
- Messages are strings — `JSON.stringify` on publish, `JSON.parse` on receive.
- Handlers are **push-based** — you register a callback (`on("message")`), you don't `await` a subscription.
- In a **Redis Cluster**, published messages stay on the same node. Use **sharded Pub/Sub** (`SSUBSCRIBE`/`SPUBLISH`) for cluster-wide delivery.

At this point all three messaging tools I've touched fit together like this:

```
              Durable?   Fan-out?   Ack / retry?
Lists         yes        no         no
Pub/Sub       no         yes        no
Streams       yes        yes        yes        (not covered yet)
```

**Files:**
```
api.js          →  publisher; POST /notification publishes to "notification"
subscriber.js   →  separate connection; subscribes + handles "message" events
```
<img width="1103" height="492" alt="image" src="https://github.com/user-attachments/assets/78703bc6-ec1a-4d75-8ac7-d501239d915d" />

---

## Progression

```
#   Project            New primitive                Real-world use
──  ─────────────────  ───────────────────────────  ──────────────────────────
1   Setup              Connection + PING            Health checks
2   Banner             Strings                      Config, feature flags
3   OTP                TTL                          Expiring tokens
4   Profile            Hashes                       Object caching
5   Email queue        Lists                        Simple job queue
6   BullMQ             Queue library on Redis       Reliable job processing
7   Notifications      Pub/Sub                      Real-time fan-out
```
