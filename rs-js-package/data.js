'use strict';

const users = [
    { id: 1,  name: "Alice",   first: "Alice",   last: "Smith",   age: 28, department: "engineering", salary: 95000, country: "US", active: true  },
    { id: 2,  name: "Bob",     first: "Bob",     last: "Jones",   age: 17, department: "marketing",   salary: 0,     country: "UK", active: false },
    { id: 3,  name: "Carol",   first: "Carol",   last: "White",   age: 35, department: "engineering", salary: 120000,country: "US", active: true  },
    { id: 4,  name: "David",   first: "David",   last: "Brown",   age: 24, department: "design",      salary: 72000, country: "CA", active: true  },
    { id: 5,  name: "Eva",     first: "Eva",     last: "Davis",   age: 16, department: "marketing",   salary: 0,     country: "UK", active: false },
    { id: 6,  name: "Frank",   first: "Frank",   last: "Miller",  age: 42, department: "engineering", salary: 145000,country: "US", active: true  },
    { id: 7,  name: "Grace",   first: "Grace",   last: "Wilson",  age: 31, department: "design",      salary: 88000, country: "CA", active: true  },
    { id: 8,  name: "Henry",   first: "Henry",   last: "Moore",   age: 19, department: "marketing",   salary: 55000, country: "US", active: true  },
    { id: 9,  name: "Iris",    first: "Iris",    last: "Taylor",  age: 29, department: "engineering", salary: 110000,country: "UK", active: true  },
    { id: 10, name: "James",   first: "James",   last: "Anderson",age: 22, department: "design",      salary: 65000, country: "CA", active: true  },
];

const orders = [
    { id: 1,  userId: 1, status: "completed", amount: 250.00, product: "laptop",  country: "US" },
    { id: 2,  userId: 3, status: "completed", amount: 80.50,  product: "book",    country: "US" },
    { id: 3,  userId: 2, status: "pending",   amount: 499.99, product: "phone",   country: "UK" },
    { id: 4,  userId: 6, status: "completed", amount: 1200.00,product: "monitor", country: "US" },
    { id: 5,  userId: 4, status: "cancelled", amount: 35.00,  product: "cable",   country: "CA" },
    { id: 6,  userId: 9, status: "completed", amount: 320.00, product: "keyboard",country: "UK" },
    { id: 7,  userId: 7, status: "pending",   amount: 650.00, product: "tablet",  country: "CA" },
    { id: 8,  userId: 1, status: "completed", amount: 45.00,  product: "mouse",   country: "US" },
    { id: 9,  userId: 8, status: "completed", amount: 190.00, product: "headset", country: "US" },
    { id: 10, userId: 5, status: "cancelled", amount: 22.00,  product: "cable",   country: "UK" },
];

const events = [
    { id: 1,  type: "click",    userId: 1, page: "/home",    duration: 0   },
    { id: 2,  type: "purchase", userId: 1, page: "/checkout",duration: 120 },
    { id: 3,  type: "click",    userId: 2, page: "/product", duration: 0   },
    { id: 4,  type: "signup",   userId: 3, page: "/register",duration: 45  },
    { id: 5,  type: "click",    userId: 3, page: "/home",    duration: 0   },
    { id: 6,  type: "purchase", userId: 4, page: "/checkout",duration: 200 },
    { id: 7,  type: "click",    userId: 5, page: "/product", duration: 0   },
    { id: 8,  type: "signup",   userId: 6, page: "/register",duration: 30  },
    { id: 9,  type: "purchase", userId: 7, page: "/checkout",duration: 95  },
    { id: 10, type: "click",    userId: 8, page: "/home",    duration: 0   },
];

module.exports = { users, orders, events };
