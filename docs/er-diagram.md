# SCMS – Entity-Relationship Diagram

GitHub, VS Code (with a Mermaid extension) and https://mermaid.live render this diagram.

```mermaid
erDiagram
    CLIENTS ||--o{ USERS : "has (client role)"
    CLIENTS ||--o{ CONTRACTS : signs
    SATELLITES ||--|| ORBITS : "described by"
    SATELLITES ||--o{ TRANSPONDERS : carries
    FREQUENCY_BANDS ||--o{ TRANSPONDERS : "operates in"
    GROUND_STATIONS ||--o{ STATION_BANDS : supports
    FREQUENCY_BANDS ||--o{ STATION_BANDS : "supported by"
    SATELLITES ||--o{ COMM_WINDOWS : "visible in"
    GROUND_STATIONS ||--o{ COMM_WINDOWS : "sees"
    COMM_WINDOWS ||--o{ BOOKINGS : "hosts"
    TRANSPONDERS ||--o{ BOOKINGS : "used by"
    CONTRACTS ||--o{ BOOKINGS : "billed to"
    USERS ||--o{ BOOKINGS : "booked by"
    CONTRACTS ||--o{ BANDWIDTH_ALLOCATIONS : leases
    TRANSPONDERS ||--o{ BANDWIDTH_ALLOCATIONS : "leased slice of"
    CONTRACTS ||--o{ INVOICES : "invoiced on"

    CLIENTS {
        int client_id PK
        varchar name UK
        enum org_type
        varchar country
        varchar contact_email
    }
    USERS {
        int user_id PK
        varchar email UK
        varchar password_hash
        enum role "admin | operator | client"
        int client_id FK "NULL for staff (CHECK)"
        bool is_active
    }
    SATELLITES {
        int sat_id PK
        int norad_id UK
        varchar name UK
        varchar model
        enum orbit_type "LEO | MEO | GEO | HEO"
        varchar operator_org
        date launch_date
        decimal mass_kg
        enum status
    }
    ORBITS {
        int sat_id PK, FK
        decimal altitude_km
        decimal inclination_deg
        decimal period_min
        decimal geo_longitude
        datetime epoch
    }
    FREQUENCY_BANDS {
        int band_id PK
        varchar code UK
        decimal min_mhz
        decimal max_mhz
    }
    TRANSPONDERS {
        int transponder_id PK
        int sat_id FK
        int band_id FK
        varchar label "UK (sat_id, label)"
        decimal center_freq_mhz
        decimal bandwidth_mhz
        enum polarization
        enum status
    }
    GROUND_STATIONS {
        int station_id PK
        varchar code UK
        varchar name
        decimal latitude
        decimal longitude
        decimal antenna_diameter_m
        enum status
    }
    STATION_BANDS {
        int station_id PK, FK
        int band_id PK, FK
    }
    COMM_WINDOWS {
        int window_id PK
        int sat_id FK
        int station_id FK
        datetime aos_ts
        datetime los_ts
        decimal max_elevation_deg
    }
    CONTRACTS {
        int contract_id PK
        int client_id FK
        varchar contract_code UK
        date start_date
        date end_date
        decimal rate_per_mhz_hour
        decimal rate_per_pass_min
        enum status
    }
    BOOKINGS {
        int booking_id PK
        int window_id FK
        int sat_id FK
        int station_id FK
        int transponder_id FK
        int contract_id FK
        int booked_by FK
        datetime start_ts
        datetime end_ts
        enum purpose
        enum status
    }
    BANDWIDTH_ALLOCATIONS {
        int allocation_id PK
        int contract_id FK
        int transponder_id FK
        decimal allocated_mhz
        datetime start_ts
        datetime end_ts
        enum status
    }
    INVOICES {
        int invoice_id PK
        int contract_id FK
        date period_start "UK (contract, period)"
        date period_end
        decimal mhz_hours
        decimal pass_minutes
        decimal amount
        enum status
    }
```

`AUDIT_LOG` is not shown. It is a standalone, trigger-written table with no foreign keys, so audit history survives deletions.

## MongoDB collections (document model)

```mermaid
flowchart LR
    subgraph MySQL
      S[(satellites.sat_id)]
    end
    subgraph MongoDB
      T[telemetry<br/>time-series<br/>meta.satId, ts]
      H[telemetry_hourly<br/>_id: satId + hour]
      R[alert_rules<br/>$jsonSchema]
      A[anomalies<br/>$jsonSchema, status workflow]
      E[event_logs<br/>text index]
    end
    S -. "satId (application-level key)" .-> T
    S -.-> A
    S -.-> E
    T -- "$group/$merge roll-up" --> H
    T -- "evaluated against" --> R
    R -- "breach upserts" --> A
```
