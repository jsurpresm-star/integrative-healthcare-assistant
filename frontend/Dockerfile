FROM nginx:alpine

# Copy static files into nginx's default serve directory
COPY . /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
