import PicoGL from "../node_modules/picogl/build/module/picogl.js";
import {mat4, vec3, quat} from "../node_modules/gl-matrix/esm/index.js";

import {positions, normals, indices, uvs} from "../blender/nautilus.js"

// ******************************************************
// **               Light configuration                **
// ******************************************************

let ambientLightColor = vec3.fromValues(0.05, 0.05, 0.1);
let numberOfLights = 2;
let lightColors = [vec3.fromValues(1.0, 0.5, 0.7), vec3.fromValues(0.5, 0.6, 1.0)];
let lightInitialPositions = [vec3.fromValues(5, 0, 2), vec3.fromValues(-5, 0, 2)];
let lightPositions = [vec3.create(), vec3.create()];


// language=GLSL
let lightCalculationShader = `
    uniform vec3 cameraPosition;
    uniform vec3 ambientLightColor;    
    uniform vec3 lightColors[${numberOfLights}];        
    uniform vec3 lightPositions[${numberOfLights}];
    
    // This function calculates light reflection using Phong reflection model (ambient + diffuse + specular)
    vec4 calculateLights(vec3 normal, vec3 position) {
        vec3 viewDirection = normalize(cameraPosition.xyz - position);
        vec4 color = vec4(ambientLightColor, 1.0);
                
        for (int i = 0; i < lightPositions.length(); i++) {
            vec3 lightDirection = normalize(lightPositions[i] - position);
            
            // Lambertian reflection (ideal diffuse of matte surfaces) is also a part of Phong model                        
            float diffuse = max(dot(lightDirection, normal), 0.0);                                    
                      
            // Phong specular highlight 
            float specular = pow(max(dot(viewDirection, reflect(-lightDirection, normal)), 0.0), 10.0);
            
            // Blinn-Phong improved specular highlight                        
            //float specular = pow(max(dot(normalize(lightDirection + viewDirection), normal), 0.0), 200.0);
            
            color.rgb += lightColors[i] * diffuse + specular;
        }
        return color;
    }
`;

// language=GLSL
let fragmentShader = `
    #version 300 es
    precision highp float;        
    ${lightCalculationShader}

    uniform sampler2D tex;
    uniform samplerCube cubemap;

    in vec3 viewDir;
    in vec3 vPosition;    
    in vec3 vNormal;
    in vec4 vColor;
    in vec2 v_uv;
    
    out vec4 outColor;        
    
    void main() {
        vec3 reflectedDir = reflect(viewDir, normalize(vNormal));
        vec4 reflection = pow(texture(cubemap, reflectedDir), vec4(5.0)) * 0.3;
        
        // For Phong shading (per-fragment) move color calculation from vertex to fragment shader
        outColor = calculateLights(normalize(vNormal), vPosition) * texture(tex, v_uv) + reflection;
        // outColor = vColor;
    }
`;

// language=GLSL
let vertexShader = `
    #version 300 es
    ${lightCalculationShader}
        
    layout(location=0) in vec4 position;
    layout(location=1) in vec4 normal;
    layout(location=2) in vec2 uv;
    
    uniform mat4 viewProjectionMatrix;
    uniform mat4 modelMatrix;

    out vec3 viewDir;
    out vec3 vPosition;    
    out vec3 vNormal;
    out vec4 vColor;
    out vec2 v_uv;
    
    void main() {
        vec4 worldPosition = modelMatrix * position;
        
        vPosition = worldPosition.xyz;        
        vNormal = (modelMatrix * normal).xyz;
        v_uv = vec2(uv.x, -uv.y);
        viewDir = (modelMatrix * position).xyz - cameraPosition;
        
        // For Gouraud shading (per-vertex) move color calculation from fragment to vertex shader
        //vColor = calculateLights(normalize(vNormal), vPosition);
        
        gl_Position = viewProjectionMatrix * worldPosition;                        
    }
`;

async function loadTexture(fileName) {
    return await createImageBitmap(await (await fetch("images/" + fileName)).blob());
}

(async () => {

    let lightColors = [vec3.fromValues(1.0, 0.5, 0.7), vec3.fromValues(0.5, 0.6, 1.0)];

    app.clearColor(0.97, 0.21, 0.54, 1.0)
       .enable(PicoGL.DEPTH_TEST)
       .enable(PicoGL.CULL_FACE);

    let program = app.createProgram(vertexShader.trim(), fragmentShader.trim());

    let vertexArray = app.createVertexArray()
        .vertexAttributeBuffer(0, app.createVertexBuffer(PicoGL.FLOAT, 3, positions))
        .vertexAttributeBuffer(1, app.createVertexBuffer(PicoGL.FLOAT, 3, normals))
        .vertexAttributeBuffer(2, app.createVertexBuffer(PicoGL.FLOAT, 2, uvs))
        .indexBuffer(app.createIndexBuffer(PicoGL.UNSIGNED_INT, 3, indices));

    let projectionMatrix = mat4.create();
    let viewMatrix = mat4.create();
    let viewProjectionMatrix = mat4.create();
    let modelMatrix = mat4.create();

    let drawCall = app.createDrawCall(program, vertexArray)
        .uniform("ambientLightColor", ambientLightColor);

    const tex = await loadTexture("nautilus.jpg");
    drawCall.texture("tex", app.createTexture2D(tex, tex.width, tex.height, {
        magFilter: PicoGL.LINEAR,
        minFilter: PicoGL.LINEAR_MIPMAP_LINEAR,
        maxAnisotropy: 10
    }));

    const cubemap = app.createCubemap({
        negX: await loadTexture("stormydays_bk.png"),
        posX: await loadTexture("stormydays_ft.png"),
        negY: await loadTexture("stormydays_dn.png"),
        posY: await loadTexture("stormydays_up.png"),
        negZ: await loadTexture("stormydays_lf.png"),
        posZ: await loadTexture("stormydays_rt.png")
    });
    drawCall.texture("cubemap", cubemap);

    let startTime = new Date().getTime() / 1000;

    let cameraPosition = vec3.fromValues(0, 0, 5);

    const positionsBuffer = new Float32Array(numberOfLights * 3);
    const colorsBuffer = new Float32Array(numberOfLights * 3);

    function draw() {
        let time = new Date().getTime() / 1000 - startTime;

        mat4.fromRotationTranslation(modelMatrix, quat.fromEuler(quat.create(), -90, time * 30, 0), vec3.fromValues(0, -0.2, 0));

        mat4.perspective(projectionMatrix, Math.PI / 6, app.width / app.height, 0.1, 100.0);
        mat4.lookAt(viewMatrix, cameraPosition, vec3.fromValues(0, 0, 0), vec3.fromValues(0, 1, 0));
        mat4.multiply(viewProjectionMatrix, projectionMatrix, viewMatrix);

        drawCall.uniform("viewProjectionMatrix", viewProjectionMatrix);
        drawCall.uniform("modelMatrix", modelMatrix);
        drawCall.uniform("cameraPosition", cameraPosition);

        for (let i = 0; i < numberOfLights; i++) {
            vec3.rotateZ(lightPositions[i], lightInitialPositions[i], vec3.fromValues(0, 0, 0), time);
            positionsBuffer.set(lightPositions[i], i * 3);
            colorsBuffer.set(lightColors[i], i * 3);
        }

        drawCall.uniform("lightPositions[0]", positionsBuffer);
        drawCall.uniform("lightColors[0]", colorsBuffer);

        app.clear();
        drawCall.draw();

        requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
})();
