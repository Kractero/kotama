# Kotama

![Express.js](https://img.shields.io/badge/express.js-%23404d59.svg?style=for-the-badge&logo=express&logoColor=%2361DAFB) ![Docker](https://img.shields.io/badge/docker-%230db7ed.svg?style=for-the-badge&logo=docker&logoColor=white)

Kotama is the backend api serving [queries](https://github.com/Kractero/kee). The api is built with Express. The main endpoint for interacting with trade records is the base route. This endpoint takes the exact same format as the frontend takes, and will parse it to make the same query.

Named for the Communications leader of Veritas.

### Perform A Query

- **Endpoint:** `/api`
- **Method:** `GET`
- **Description:** Retrieve cards based on the parameters.

  - **Parameters:**

    - `select`: Expects value of `all` or `min`, although any value that is not `all` will be accepted. `all` translates to `SELECT *`, while the latter is `SELECT (id, name, season)`.
    - `from`: Expects a value of `S1`, `S2`, or `S3`. This translates to `FROM SX`.
    - `clauses`: A WHERE clause associated with a WHERE clause. Clauses are comma separated, and are formatted like `AND`-`field`-`SPECIFY OPERATOR`-`VALUE`. For example, `name`-`LIKE`-`test`,`AND`-`cardcategory`-`IS`-`legendary`. Or is not supported.

  - **Rate Limit:** 50 requests per 30 seconds.
