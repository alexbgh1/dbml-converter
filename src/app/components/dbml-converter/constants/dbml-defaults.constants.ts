const DBML_DEFAULT_VALUE = `Table users {
  id int [pk, increment]
  name varchar [note: 'User full name']
}`;

const DBML_DEFAULT_EXAMPLE = `Table users {
  id int [pk, increment]
  name varchar [default: "123", not null]
  email varchar [unique, not null, note: 'User email address']
  created_at timestamp
}

Table posts {
  id int [pk, increment]
  user_id int [ref: > users.id]
  title varchar
  content text
  created_at timestamp
}

// Explicit relationship
Ref: posts.user_id > users.id`;

export { DBML_DEFAULT_VALUE, DBML_DEFAULT_EXAMPLE };
